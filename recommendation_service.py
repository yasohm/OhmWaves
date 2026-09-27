"""Hybrid, personal recommendations for the local OhmWaves app.

OhmWaves usually has a single listener, so pure collaborative filtering has
nothing to learn from. The engine therefore combines several signals:

1. **Taste profile.** Every play, skip, and like becomes a weighted, time-decayed
   affinity for the track and its artist. Full listens count positively, early
   skips count negatively, and likes count the most.
2. **Candidate generation.** Seeds are sampled from the listener's strongest
   tracks and artists and expanded through the catalog (YouTube Music radio and
   artist top tracks). When several seeds point at the same song, their votes
   add up. With more than one listener, implicit ALS adds its own candidates.
3. **Ranking.** Candidates are re-scored with artist affinity, penalties for
   recent skips and already-heard tracks, and a diversity pass that caps
   repeats from the same artist.
4. **Explanations.** Each result carries a human-readable reason, such as
   "Because you liked Blinding Lights".

The catalog is injected, so the engine can be tested offline. Anything with
``get_related_tracks(video_id)``, ``get_artist_top_tracks(name)`` and
``get_trending_tracks()`` works.
"""
from __future__ import annotations

import json
import math
import os
import pickle
import random
import re
import sqlite3
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

DB_PATH = os.environ.get("OHMWAVE_DB", "ohmwave.db")
MODEL_PATH = os.environ.get("OHMWAVE_MODEL", "models/als_latest.pkl")

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Tunable model weights. Kept together so behaviour is easy to reason about.
PLAY_HALF_LIFE_DAYS = 30.0
LIKE_HALF_LIFE_DAYS = 180.0
LIKE_WEIGHT = 3.0
ARTIST_SHARE = 0.5
SKIP_THRESHOLD_MS = 30_000
CATALOG_TTL_SECONDS = 12 * 3600
MAX_PER_ARTIST = 2
MAX_SEEDS = 5


def primary_artist(artist: str) -> str:
    """Normalised lead artist ("Drake, Rihanna" -> "drake")."""
    return re.split(r",|&| feat\.? | ft\.? | x ", (artist or "").lower())[0].strip()


def _parse_time(value: str | None) -> float:
    if not value:
        return time.time()
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return time.time()


def _decay(timestamp: float, half_life_days: float, now: float) -> float:
    age_days = max(0.0, (now - timestamp) / 86400.0)
    return 0.5 ** (age_days / half_life_days)


def play_signal(ms_played: int, duration_ms: int, completed: bool, skipped: bool) -> float:
    """Convert one listening event into an implicit-feedback score in [-1, 1]."""
    ratio = (ms_played / duration_ms) if duration_ms else min(1.0, ms_played / 180_000.0)
    ratio = max(0.0, min(1.0, ratio))
    if completed or ratio >= 0.8:
        return 1.0
    if skipped and (ms_played < SKIP_THRESHOLD_MS or ratio < 0.3):
        return -1.0
    return 0.15 + ratio * 0.6


class TasteProfile:
    """Time-decayed affinities built from a listener's history."""

    def __init__(self):
        self.track_affinity = defaultdict(float)
        self.artist_affinity = defaultdict(float)
        self.recent_skips = defaultdict(int)
        self.play_counts = defaultdict(int)
        self.metadata = {}
        self.liked = set()
        self.recent = []  # track ids, most recent first

    @property
    def is_cold(self) -> bool:
        return not any(score > 0 for score in self.track_affinity.values())

    def top_tracks(self, limit=10, playable_only=False):
        ranked = sorted(((t, s) for t, s in self.track_affinity.items() if s > 0),
                        key=lambda item: item[1], reverse=True)
        if playable_only:
            ranked = [(t, s) for t, s in ranked if VIDEO_ID_RE.match(t)]
        return ranked[:limit]

    def top_artists(self, limit=5):
        ranked = sorted(((a, s) for a, s in self.artist_affinity.items() if s > 0 and a),
                        key=lambda item: item[1], reverse=True)
        return ranked[:limit]

    def display_artist(self, artist_key):
        for meta in self.metadata.values():
            if primary_artist(meta.get("artist", "")) == artist_key:
                return meta["artist"].split(",")[0].strip()
        return artist_key.title()


class RecommendationService:
    def __init__(self, db_path=DB_PATH, model_path=MODEL_PATH, catalog=None):
        self.db_path = db_path
        self.model_path = model_path
        self.catalog = catalog
        self._model_lock = threading.Lock()
        self._model = None
        self._model_data = None
        os.makedirs(os.path.dirname(model_path) or ".", exist_ok=True)
        self._init_db()
        self._load_model()

    # ------------------------------------------------------------------ storage

    def _connect(self):
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self):
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS listening_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    track_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    artist TEXT NOT NULL DEFAULT '',
                    album TEXT NOT NULL DEFAULT '',
                    cover TEXT,
                    played_at TEXT NOT NULL,
                    ms_played INTEGER NOT NULL DEFAULT 0,
                    completed INTEGER NOT NULL DEFAULT 0,
                    skipped INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS user_likes (
                    user_id TEXT NOT NULL,
                    track_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    artist TEXT NOT NULL DEFAULT '',
                    album TEXT NOT NULL DEFAULT '',
                    cover TEXT,
                    liked_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, track_id)
                );
                CREATE TABLE IF NOT EXISTS catalog_cache (
                    cache_key TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    fetched_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_events_user_track
                    ON listening_events(user_id, track_id);
                CREATE INDEX IF NOT EXISTS idx_events_user_time
                    ON listening_events(user_id, played_at);
            """)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(listening_events)")}
            if "duration_ms" not in columns:
                db.execute("ALTER TABLE listening_events ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0")

    @staticmethod
    def _require(payload, keys=("user_id", "track_id", "title")):
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object")
        if any(not str(payload.get(key, "")).strip() for key in keys):
            raise ValueError(f"{', '.join(keys)} are required")

    def record_event(self, event):
        self._require(event)
        with self._connect() as db:
            db.execute("""
                INSERT INTO listening_events
                (user_id, track_id, title, artist, album, cover, played_at,
                 ms_played, duration_ms, completed, skipped)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                str(event["user_id"])[:64], str(event["track_id"])[:512], str(event["title"])[:300],
                str(event.get("artist") or "")[:300], str(event.get("album") or "")[:300], event.get("cover"),
                event.get("played_at") or datetime.now(timezone.utc).isoformat(),
                max(0, int(event.get("ms_played") or 0)),
                max(0, int(event.get("duration_ms") or 0)),
                int(bool(event.get("completed", False))),
                int(bool(event.get("skipped", False))),
            ))

    def set_like(self, payload):
        self._require(payload)
        with self._connect() as db:
            db.execute("""
                INSERT INTO user_likes
                (user_id, track_id, title, artist, album, cover, liked_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, track_id) DO UPDATE SET liked_at=excluded.liked_at
            """, (
                str(payload["user_id"])[:64], str(payload["track_id"])[:512], str(payload["title"])[:300],
                str(payload.get("artist") or "")[:300], str(payload.get("album") or "")[:300], payload.get("cover"),
                datetime.now(timezone.utc).isoformat(),
            ))

    def remove_like(self, payload):
        self._require(payload, ("user_id", "track_id"))
        with self._connect() as db:
            db.execute("DELETE FROM user_likes WHERE user_id = ? AND track_id = ?",
                       (str(payload["user_id"]), str(payload["track_id"])))

    def list_likes(self, user_id):
        with self._connect() as db:
            rows = db.execute("SELECT * FROM user_likes WHERE user_id = ? ORDER BY liked_at DESC",
                              (str(user_id),)).fetchall()
        return [self._public_track(dict(row)) for row in rows]

    def recently_played(self, user_id, limit=20):
        with self._connect() as db:
            rows = db.execute("""
                SELECT e.* FROM listening_events e
                JOIN (SELECT track_id, MAX(id) AS last_id FROM listening_events
                      WHERE user_id = ? GROUP BY track_id) latest ON latest.last_id = e.id
                ORDER BY e.id DESC LIMIT ?
            """, (str(user_id), int(limit))).fetchall()
        return [self._public_track(dict(row)) for row in rows]

    @staticmethod
    def _public_track(row, **extra):
        track_id = row.get("track_id") or row.get("videoId") or row.get("id")
        is_video = bool(track_id and VIDEO_ID_RE.match(str(track_id)))
        track = {
            "id": track_id,
            "videoId": track_id if is_video else None,
            "title": row.get("title") or "Untitled",
            "artist": row.get("artist") or "",
            "album": row.get("album") or "",
            "cover": row.get("cover"),
            "duration": row.get("duration") or "",
        }
        if not is_video:
            track["relative_path"] = track_id
        track.update(extra)
        return track

    # ----------------------------------------------------------- taste profile

    def _rows(self, user_id=None):
        with self._connect() as db:
            if user_id is None:
                events = db.execute("SELECT * FROM listening_events ORDER BY id").fetchall()
                likes = db.execute("SELECT * FROM user_likes").fetchall()
            else:
                events = db.execute("SELECT * FROM listening_events WHERE user_id = ? ORDER BY id",
                                    (str(user_id),)).fetchall()
                likes = db.execute("SELECT * FROM user_likes WHERE user_id = ?", (str(user_id),)).fetchall()
        return events, likes

    def build_profile(self, user_id) -> TasteProfile:
        events, likes = self._rows(user_id)
        profile = TasteProfile()
        now = time.time()
        recent_cutoff = now - 14 * 86400
        for row in events:
            timestamp = _parse_time(row["played_at"])
            signal = play_signal(row["ms_played"], row["duration_ms"], bool(row["completed"]), bool(row["skipped"]))
            weight = signal * _decay(timestamp, PLAY_HALF_LIFE_DAYS, now)
            profile.track_affinity[row["track_id"]] += weight
            profile.artist_affinity[primary_artist(row["artist"])] += weight * ARTIST_SHARE
            profile.play_counts[row["track_id"]] += 1
            if signal < 0 and timestamp >= recent_cutoff:
                profile.recent_skips[row["track_id"]] += 1
            profile.metadata[row["track_id"]] = dict(row)
            profile.recent.insert(0, row["track_id"])
        for row in likes:
            weight = LIKE_WEIGHT * _decay(_parse_time(row["liked_at"]), LIKE_HALF_LIFE_DAYS, now)
            profile.track_affinity[row["track_id"]] += weight
            profile.artist_affinity[primary_artist(row["artist"])] += weight * ARTIST_SHARE
            profile.liked.add(row["track_id"])
            profile.metadata[row["track_id"]] = dict(row)
        return profile

    # ---------------------------------------------------------------- catalog

    def _cached(self, key, fetch):
        """Read-through SQLite cache so repeated home loads stay fast and polite."""
        with self._connect() as db:
            row = db.execute("SELECT payload, fetched_at FROM catalog_cache WHERE cache_key = ?", (key,)).fetchone()
        if row and time.time() - row["fetched_at"] < CATALOG_TTL_SECONDS:
            return json.loads(row["payload"])
        try:
            data = fetch() or []
        except Exception as err:  # Network or catalog failure: serve stale data if we have it.
            print(f"Catalog lookup failed for {key}: {err}")
            return json.loads(row["payload"]) if row else []
        compact = [{k: t.get(k) for k in ("videoId", "title", "artist", "album", "cover", "duration")}
                   for t in data if t.get("videoId")]
        with self._connect() as db:
            db.execute("INSERT OR REPLACE INTO catalog_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)",
                       (key, json.dumps(compact), time.time()))
        return compact

    def _related(self, video_id):
        if not self.catalog or not VIDEO_ID_RE.match(str(video_id)):
            return []
        return self._cached(f"related:{video_id}", lambda: self.catalog.get_related_tracks(video_id))

    def _artist_tracks(self, artist_name):
        if not self.catalog or not artist_name:
            return []
        return self._cached(f"artist:{artist_name.lower()}", lambda: self.catalog.get_artist_top_tracks(artist_name))

    def _trending(self):
        if not self.catalog:
            return []
        return self._cached("trending:global", self.catalog.get_trending_tracks)

    # ---------------------------------------------------------------- ranking

    def _pick_seeds(self, profile, user_id):
        """Weighted sample from the strongest tracks. It changes every few hours, so mixes stay fresh."""
        pool = profile.top_tracks(limit=15, playable_only=True)
        if not pool:
            return []
        rng = random.Random(f"{user_id}:{int(time.time() // (6 * 3600))}")
        seeds, remaining = [], list(pool)
        while remaining and len(seeds) < MAX_SEEDS:
            total = sum(max(score, 0.01) for _, score in remaining)
            pick, cursor = rng.uniform(0, total), 0.0
            for index, (track_id, score) in enumerate(remaining):
                cursor += max(score, 0.01)
                if cursor >= pick:
                    seeds.append((track_id, score))
                    remaining.pop(index)
                    break
        return seeds

    def _als_candidates(self, user_id, limit):
        with self._model_lock:
            model, payload = self._model, self._model_data
        if not model or not payload or str(user_id) not in payload.get("users", []) or len(payload["users"]) < 2:
            return []
        try:
            user_index = payload["users"].index(str(user_id))
            ids, values = model.recommend(user_index, payload["matrix"][user_index], N=limit,
                                          filter_already_liked_items=True)
            top = max((float(v) for v in values), default=1.0) or 1.0
            return [(payload["tracks"][int(i)], float(v) / top, payload["metadata"].get(payload["tracks"][int(i)], {}))
                    for i, v in zip(ids, values)]
        except Exception as err:
            print(f"ALS recommendation failed: {err}")
            return []

    def _score(self, candidates, profile, exclude, allow_known=False):
        """Final ranking: vote strength, artist taste, skip history and familiarity."""
        ranked = []
        for track_id, entry in candidates.items():
            if track_id in exclude or profile.recent_skips.get(track_id, 0) >= 2:
                continue
            known = profile.track_affinity.get(track_id, 0.0)
            if known < 0 or (known > 0 and not allow_known):
                continue
            artist_score = max(-2.0, min(3.0, profile.artist_affinity.get(primary_artist(entry["track"]["artist"]), 0.0)))
            score = entry["votes"] + 0.35 * artist_score + 0.15 * math.log1p(entry["sources"])
            ranked.append((score, track_id, entry))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return ranked

    @staticmethod
    def _diversify(ranked, limit, max_per_artist=MAX_PER_ARTIST):
        """Greedy re-rank so a single artist cannot dominate a mix."""
        chosen, overflow, per_artist = [], [], defaultdict(int)
        for score, track_id, entry in ranked:
            artist = primary_artist(entry["track"]["artist"])
            if per_artist[artist] < max_per_artist:
                per_artist[artist] += 1
                chosen.append((score, track_id, entry))
            else:
                overflow.append((score * 0.6, track_id, entry))
            if len(chosen) >= limit:
                return chosen
        return (chosen + sorted(overflow, key=lambda item: item[0], reverse=True))[:limit]

    @staticmethod
    def _add_candidate(candidates, track, weight, reason):
        track_id = track.get("videoId") or track.get("track_id") or track.get("id")
        if not track_id:
            return
        entry = candidates.setdefault(track_id, {"track": track, "votes": 0.0, "sources": 0, "reason": reason, "best": 0.0})
        entry["votes"] += weight
        entry["sources"] += 1
        if weight > entry["best"]:
            entry["best"], entry["reason"] = weight, reason

    def _expand(self, sources, workers=6):
        """Fetch catalog lists in parallel: [(key, fetch)] -> {key: tracks}."""
        if not sources:
            return {}
        with ThreadPoolExecutor(max_workers=min(workers, len(sources))) as pool:
            results = pool.map(lambda item: (item[0], item[1]()), sources)
            return dict(results)

    def _format(self, ranked):
        return [self._public_track(dict(entry["track"], track_id=track_id),
                                   reason=entry["reason"], recommendation_score=round(score, 4))
                for score, track_id, entry in ranked]

    # ----------------------------------------------------------------- public

    def recommend(self, user_id, limit=20, profile=None):
        """Personal discovery mix: new tracks, ranked and diversified."""
        limit = min(50, max(1, int(limit)))
        profile = profile or self.build_profile(user_id)
        if profile.is_cold:
            trending = self._trending()
            return [self._public_track(dict(t, track_id=t["videoId"]), reason="Trending worldwide")
                    for t in trending][:limit]

        seeds = self._pick_seeds(profile, user_id)
        top_artists = profile.top_artists(limit=3)
        fetched = self._expand(
            [(("seed", tid), lambda tid=tid: self._related(tid)) for tid, _ in seeds] +
            [(("artist", key), lambda key=key: self._artist_tracks(profile.display_artist(key))) for key, _ in top_artists]
        )
        max_seed = max((score for _, score in seeds), default=1.0) or 1.0
        candidates = {}
        for track_id, score in seeds:
            seed_meta = profile.metadata.get(track_id, {})
            verb = "liked" if track_id in profile.liked else "played"
            reason = f"Because you {verb} {seed_meta.get('title', 'a song you love')}"
            for rank, track in enumerate(fetched.get(("seed", track_id), [])):
                self._add_candidate(candidates, track, (score / max_seed) / (1 + 0.08 * rank), reason)
        max_artist = max((score for _, score in top_artists), default=1.0) or 1.0
        for key, score in top_artists:
            reason = f"More from {profile.display_artist(key)}"
            for rank, track in enumerate(fetched.get(("artist", key), [])):
                self._add_candidate(candidates, track, 0.6 * (score / max_artist) / (1 + 0.1 * rank), reason)
        for track_id, score, meta in self._als_candidates(user_id, limit):
            if meta:
                self._add_candidate(candidates, dict(meta, videoId=track_id), 0.8 * score, "Listeners like you enjoy this")

        ranked = self._score(candidates, profile, exclude=set())
        return self._format(self._diversify(ranked, limit))

    def next_tracks(self, user_id, seed, exclude=(), limit=10):
        """Autoplay: continue from the current song, reranked for this listener."""
        limit = min(25, max(1, int(limit)))
        profile = self.build_profile(user_id)
        exclude = set(exclude) | set(profile.recent[:30])
        seed_id = (seed or {}).get("videoId") or (seed or {}).get("id")
        candidates = {}
        related = self._related(seed_id) if seed_id else []
        if not related and seed and seed.get("artist"):
            related = self._artist_tracks(seed["artist"].split(",")[0].strip())
        title = (seed or {}).get("title") or "this song"
        for rank, track in enumerate(related):
            self._add_candidate(candidates, track, 1.0 / (1 + 0.05 * rank), f"Autoplay from {title}")
        exclude.add(seed_id)
        ranked = self._score(candidates, profile, exclude=exclude, allow_known=True)
        if not ranked:
            return self.recommend(user_id, limit, profile=profile)
        return self._format(self._diversify(ranked, limit, max_per_artist=3))

    def home(self, user_id):
        """Shelves for the Home screen, from most personal to most general."""
        profile = self.build_profile(user_id)
        # Warm every catalog list the shelves need in parallel; later reads hit the cache.
        with ThreadPoolExecutor(max_workers=4) as pool:
            warmups = [pool.submit(self._trending)]
            warmups += [pool.submit(self._related, tid) for tid, _ in profile.top_tracks(limit=2, playable_only=True)]
            mix = self.recommend(user_id, limit=24, profile=profile)
            for future in warmups:
                future.result()
        sections = []
        recent = self.recently_played(user_id, limit=12)
        if recent:
            sections.append({"id": "recent", "title": "Recently played", "kind": "tracks", "tracks": recent})

        if not profile.is_cold and mix:
            sections.append({"id": "for-you", "title": "Made for you",
                             "subtitle": "New picks based on what you play, skip and like",
                             "kind": "tracks", "tracks": mix})
            top = profile.top_tracks(limit=12)
            on_repeat = [self._public_track(profile.metadata[t]) for t, _ in top if t in profile.metadata]
            if len(on_repeat) >= 3:
                sections.append({"id": "on-repeat", "title": "On repeat",
                                 "subtitle": "The songs you keep coming back to",
                                 "kind": "tracks", "tracks": on_repeat})
            shown = {t["id"] for t in mix[:12]}  # what's visible in "Made for you" without scrolling
            for track_id, _ in profile.top_tracks(limit=2, playable_only=True):
                meta = profile.metadata.get(track_id, {})
                related = self._related(track_id)
                candidates = {}
                for rank, track in enumerate(related):
                    self._add_candidate(candidates, track, 1.0 / (1 + 0.05 * rank), f"Similar to {meta.get('title')}")
                ranked = self._score(candidates, profile, exclude=shown)
                tracks = self._format(self._diversify(ranked, 16))
                shown |= {t["id"] for t in tracks}
                if len(tracks) >= 4:
                    sections.append({"id": f"because-{track_id}", "title": f"Because you like {meta.get('title')}",
                                     "subtitle": meta.get("artist", ""), "kind": "tracks", "tracks": tracks})
            artists = [{"name": profile.display_artist(key), "cover": next(
                (m.get("cover") for m in profile.metadata.values() if primary_artist(m.get("artist", "")) == key and m.get("cover")), None)}
                for key, _ in profile.top_artists(limit=8)]
            if artists:
                sections.append({"id": "top-artists", "title": "Your top artists", "kind": "artists", "artists": artists})

        trending = self._trending()
        if trending:
            sections.append({"id": "trending", "title": "Trending worldwide", "subtitle": "What everyone is playing right now",
                             "kind": "tracks",
                             "tracks": [self._public_track(dict(t, track_id=t["videoId"])) for t in trending][:20]})
        return {"sections": sections, "cold_start": profile.is_cold,
                "top_artists": [profile.display_artist(key) for key, _ in profile.top_artists(limit=5)]}

    # ------------------------------------------------------------ ALS (multi-user)

    def _scores(self):
        events, likes = self._rows()
        scores = defaultdict(float)
        metadata = {}
        users, tracks = set(), set()
        for row in events:
            key = (row["user_id"], row["track_id"])
            scores[key] += play_signal(row["ms_played"], row["duration_ms"], bool(row["completed"]), bool(row["skipped"])) + 1.0
            users.add(row["user_id"]); tracks.add(row["track_id"])
            metadata[row["track_id"]] = dict(row)
        for row in likes:
            key = (row["user_id"], row["track_id"])
            scores[key] += LIKE_WEIGHT
            users.add(row["user_id"]); tracks.add(row["track_id"])
            metadata[row["track_id"]] = dict(row)
        return scores, metadata, sorted(users), sorted(tracks)

    def retrain(self):
        """Fit implicit ALS. Only useful with several listeners; the hybrid engine works without it."""
        scores, metadata, users, tracks = self._scores()
        if len(users) < 2 or len(tracks) < 2:
            with self._model_lock:
                self._model, self._model_data = None, None
            return {"trained": False, "algorithm": "hybrid",
                    "reason": "ALS needs at least two listeners; personal hybrid ranking is active"}
        try:
            from scipy.sparse import csr_matrix
            import implicit
        except ImportError:
            return {"trained": False, "algorithm": "hybrid", "reason": "install scipy and implicit for ALS"}
        user_index = {value: i for i, value in enumerate(users)}
        track_index = {value: i for i, value in enumerate(tracks)}
        rows, cols, values = [], [], []
        for (user, track), score in scores.items():
            if score > 0:
                rows.append(user_index[user]); cols.append(track_index[track]); values.append(score)
        matrix = csr_matrix((values, (rows, cols)), shape=(len(users), len(tracks)))
        model = implicit.als.AlternatingLeastSquares(
            factors=min(64, max(8, len(tracks) // 2)), regularization=0.05, iterations=20
        )
        model.fit(matrix, show_progress=False)
        payload = {"model": model, "matrix": matrix, "metadata": metadata, "users": users, "tracks": tracks}
        with open(self.model_path, "wb") as handle:
            pickle.dump(payload, handle)
        with self._model_lock:
            self._model, self._model_data = model, payload
        return {"trained": True, "users": len(users), "tracks": len(tracks), "algorithm": "hybrid+als"}

    def _load_model(self):
        try:
            with open(self.model_path, "rb") as handle:
                payload = pickle.load(handle)
            self._model = payload.get("model")
            self._model_data = payload
        except (OSError, EOFError, pickle.PickleError, AttributeError, ImportError):
            pass
