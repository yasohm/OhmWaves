"""AI-music filter tests: verdict priorities, filtering and API shapes (temporary database, no network)."""
import os
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_detector.features import FEATURE_SIZE  # noqa: E402
from ai_detector.model import AIMusicModel  # noqa: E402
from ai_filter_service import AIFilterService  # noqa: E402

AI_CHANNEL = "UCaiaiaiaiaiaiaiaiaiaiai"


def song(n, artist_id=None):
    return {"videoId": f"vid{n:08d}", "id": f"vid{n:08d}", "title": f"Song {n}", "artist": "Someone",
            "artistId": artist_id, "cover": "https://example.com/c.jpg"}


class AIFilterServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.service = AIFilterService(db_path=os.path.join(self.tmp.name, "f.db"), model_path=os.path.join(self.tmp.name, "none.npz"),
                                       autostart=False)
        self.service.ai_channels = {AI_CHANNEL}
        self.service.model = AIMusicModel(np.zeros(FEATURE_SIZE), np.ones(FEATURE_SIZE), np.zeros(FEATURE_SIZE), 0.0, 0.8,
                                          {"version": "v1"})

    def tearDown(self):
        self.tmp.cleanup()

    def score(self, track, probability, version="v1"):
        self.service.model.info["version"] = version
        self.service._record(track, is_ai=probability >= 0.8, reason="model", probability=probability)
        self.service.model.info["version"] = "v1"

    def test_listed_artists_and_model_scores_are_hidden(self):
        listed, flagged, clean, unknown = song(1, AI_CHANNEL), song(2), song(3), song(4)
        self.score(flagged, 0.95)
        self.score(clean, 0.10)
        kept, hidden = self.service.filter_tracks([listed, flagged, clean, unknown])
        self.assertEqual([t["videoId"] for t in kept], [clean["videoId"], unknown["videoId"]])
        self.assertEqual(hidden, 2)

    def test_your_choice_beats_list_and_model(self):
        listed, flagged = song(1, AI_CHANNEL), song(2)
        self.score(flagged, 0.99)
        self.service.mark(listed, "human")
        self.service.mark(flagged, "human")
        kept, hidden = self.service.filter_tracks([listed, flagged])
        self.assertEqual(hidden, 0)
        self.score(flagged, 0.99)  # a later scan must not undo your decision
        self.assertEqual(self.service.filter_tracks([flagged])[1], 0)
        self.service.mark(song(5), "ai")
        self.assertEqual(self.service.filter_tracks([song(5)])[1], 1)

    def test_scores_from_an_older_model_are_ignored(self):
        old = song(1)
        self.score(old, 0.99, version="v0")
        self.assertIsNone(self.service.classify(old, self.service._verdicts([old["videoId"]])[old["videoId"]]))

    def test_turning_the_filter_off_shows_everything(self):
        self.service.set_enabled(False)
        self.assertEqual(self.service.filter_tracks([song(1, AI_CHANNEL)])[1], 0)
        self.service.set_enabled(True)
        self.assertTrue(self.service.status()["enabled"])

    def test_flagged_since_lists_new_ai_songs(self):
        self.service.mark(song(1), "ai")
        flagged = self.service.flagged_since("")
        self.assertEqual([t["videoId"] for t in flagged], [song(1)["videoId"]])
        self.assertTrue(flagged[0]["ai"]["yours"])
        self.assertEqual(self.service.flagged_since(flagged[0]["ai"]["flagged_at"]), [])

    def test_bad_marks_are_refused(self):
        with self.assertRaises(ValueError):
            self.service.mark(song(1), "maybe")
        with self.assertRaises(ValueError):
            self.service.mark({"videoId": "../../etc"}, "ai")


class HideAiResponsesTest(unittest.TestCase):
    def setUp(self):
        import app as server
        self.server = server
        self.tmp = tempfile.TemporaryDirectory()
        self.original = server.ai_filter
        server.ai_filter = AIFilterService(db_path=os.path.join(self.tmp.name, "f.db"), model_path=os.path.join(self.tmp.name, "none.npz"),
                                           autostart=False)
        server.ai_filter.ai_channels = {AI_CHANNEL}

    def tearDown(self):
        self.server.ai_filter = self.original
        self.tmp.cleanup()

    def test_every_response_shape_is_cleaned(self):
        hide = self.server.hide_ai
        self.assertEqual(len(hide({"songs": [song(1, AI_CHANNEL), song(2)]})["songs"]), 1)
        artists = hide({"artists": [{"type": "artist", "id": AI_CHANNEL, "songs": [song(1)]},
                                    {"type": "artist", "id": "UChuman", "songs": [song(2), song(3, AI_CHANNEL)]}]})
        self.assertEqual([a["id"] for a in artists["artists"]], ["UChuman"])
        self.assertEqual(len(artists["artists"][0]["songs"]), 1)
        albums = hide({"albums": [{"artistId": AI_CHANNEL, "tracks": []}, {"artistId": "UChuman", "tracks": [song(4)]}]})
        self.assertEqual(len(albums["albums"]), 1)
        home = hide({"sections": [{"tracks": [song(1, AI_CHANNEL), song(2)]}]})
        self.assertEqual(len(home["sections"][0]["tracks"]), 1)
        self.assertEqual(home["ai_hidden"], 1)

    def test_api_marks_and_settings(self):
        client = self.server.app.test_client()
        marked = client.post("/api/ai-filter/mark", json={"track": song(7), "verdict": "ai"})
        self.assertEqual(marked.status_code, 200)
        self.assertEqual(client.get("/api/ai-filter/flagged").get_json()["data"]["tracks"][0]["videoId"], song(7)["videoId"])
        self.assertEqual(client.post("/api/ai-filter", json={"enabled": "yes"}).status_code, 400)
        self.assertFalse(client.post("/api/ai-filter", json={"enabled": False}).get_json()["data"]["enabled"])


if __name__ == "__main__":
    unittest.main()
