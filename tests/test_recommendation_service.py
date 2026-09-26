"""Offline tests for the hybrid recommender (no network: the catalog is faked)."""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recommendation_service import RecommendationService, play_signal, primary_artist  # noqa: E402


def vid(n):
    return f"vid{n:08d}"  # 11 characters, like a real YouTube id


def track(n, artist):
    return {"videoId": vid(n), "title": f"Song {n}", "artist": artist, "album": "", "cover": None, "duration": "3:00"}


class FakeCatalog:
    def __init__(self):
        self.related = {
            vid(1): [track(10, "Nova"), track(11, "Nova"), track(12, "Nova"), track(13, "Pulse"), track(2, "Echo")],
            vid(2): [track(13, "Pulse"), track(14, "Drift"), track(15, "Skipper")],
        }
        self.calls = 0

    def get_related_tracks(self, video_id):
        self.calls += 1
        return self.related.get(video_id, [])

    def get_artist_top_tracks(self, name):
        return [track(20, name), track(21, name)]

    def get_trending_tracks(self):
        return [track(90, "Chart"), track(91, "Chart")]


class RecommendationServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.catalog = FakeCatalog()
        self.service = RecommendationService(db_path=os.path.join(self.tmp.name, "t.db"),
                                             model_path=os.path.join(self.tmp.name, "m.pkl"),
                                             catalog=self.catalog)
        self.user = "tester"

    def tearDown(self):
        self.tmp.cleanup()

    def play(self, n, artist, ms=180_000, duration=180_000, skipped=False, completed=None, **extra):
        self.service.record_event({"user_id": self.user, "track_id": vid(n), "title": f"Song {n}", "artist": artist,
                                   "ms_played": ms, "duration_ms": duration, "skipped": skipped,
                                   "completed": ms >= duration if completed is None else completed, **extra})

    def test_play_signal(self):
        self.assertEqual(play_signal(180_000, 180_000, True, False), 1.0)
        self.assertEqual(play_signal(5_000, 180_000, False, True), -1.0)
        self.assertTrue(0 < play_signal(60_000, 180_000, False, False) < 1)

    def test_primary_artist(self):
        self.assertEqual(primary_artist("Drake, Rihanna"), "drake")
        self.assertEqual(primary_artist("Calvin Harris feat. Dua Lipa"), "calvin harris")

    def test_cold_start_returns_trending_with_reason(self):
        recs = self.service.recommend(self.user)
        self.assertEqual([r["id"] for r in recs], [vid(90), vid(91)])
        self.assertEqual(recs[0]["reason"], "Trending worldwide")
        self.assertTrue(self.service.home(self.user)["cold_start"])

    def test_single_user_gets_non_empty_personal_recommendations(self):
        # Regression: the old popular-track fallback returned nothing for a lone listener.
        self.play(1, "Echo")
        self.service.set_like({"user_id": self.user, "track_id": vid(1), "title": "Song 1", "artist": "Echo"})
        recs = self.service.recommend(self.user)
        self.assertTrue(recs)
        ids = [r["id"] for r in recs]
        self.assertNotIn(vid(1), ids, "already-known tracks are not rediscovered")
        self.assertIn("Because you liked Song 1", {r["reason"] for r in recs})

    def test_shared_candidates_rank_higher_and_skips_are_penalised(self):
        self.play(1, "Echo")
        self.play(2, "Echo")
        ids = [r["id"] for r in self.service.recommend(self.user)]
        self.assertEqual(ids[0], vid(13), "a track suggested by two seeds wins")

        for _ in range(2):
            self.play(15, "Skipper", ms=4_000, skipped=True)
        self.assertNotIn(vid(15), [r["id"] for r in self.service.recommend(self.user)])

    def test_diversity_caps_artist_repeats(self):
        self.play(1, "Echo")
        recs = self.service.recommend(self.user, limit=3)
        artists = [r["artist"] for r in recs]
        self.assertLessEqual(artists.count("Nova"), 2)

    def test_old_plays_decay(self):
        old = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
        self.play(1, "Echo", played_at=old)
        self.play(2, "Echo")
        profile = self.service.build_profile(self.user)
        self.assertLess(profile.track_affinity[vid(1)], profile.track_affinity[vid(2)] / 4)

    def test_like_roundtrip_and_unlike(self):
        payload = {"user_id": self.user, "track_id": vid(3), "title": "Song 3", "artist": "X"}
        self.service.set_like(payload)
        self.assertEqual([t["id"] for t in self.service.list_likes(self.user)], [vid(3)])
        self.service.remove_like(payload)
        self.assertEqual(self.service.list_likes(self.user), [])

    def test_validation(self):
        with self.assertRaises(ValueError):
            self.service.record_event({"user_id": self.user})
        with self.assertRaises(ValueError):
            self.service.remove_like({"user_id": self.user})

    def test_next_tracks_excludes_queue_and_recent(self):
        self.play(1, "Echo")
        nxt = self.service.next_tracks(self.user, {"videoId": vid(1), "title": "Song 1"}, exclude=[vid(10)])
        ids = [t["id"] for t in nxt]
        self.assertNotIn(vid(10), ids)
        self.assertNotIn(vid(1), ids)
        self.assertTrue(ids)

    def test_catalog_results_are_cached(self):
        self.play(1, "Echo")
        self.service.recommend(self.user)
        calls = self.catalog.calls
        self.service.recommend(self.user)
        self.assertEqual(self.catalog.calls, calls)

    def test_home_sections_for_active_listener(self):
        for n in (1, 2, 1):
            self.play(n, "Echo")
        ids = [s["id"] for s in self.service.home(self.user)["sections"]]
        self.assertEqual(ids[:2], ["recent", "for-you"])
        self.assertIn("trending", ids)

    def test_recently_played_is_deduplicated(self):
        for n in (1, 2, 1):
            self.play(n, "Echo")
        self.assertEqual([t["id"] for t in self.service.recently_played(self.user)], [vid(1), vid(2)])

    def test_retrain_single_user_is_graceful(self):
        self.play(1, "Echo")
        self.assertFalse(self.service.retrain()["trained"])


if __name__ == "__main__":
    unittest.main()
