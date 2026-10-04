"""
Keeps AI-generated songs out of the app.

A song counts as AI-generated when (in this order of priority):
1. you said so ("Mark as AI"), or you said it isn't ("Not AI"), which always wins over the signals below;
2. its artist is a confirmed AI artist in the Soul Over AI directory (matched by YouTube channel id);
3. the trained detector (ai_detector/) scores its audio above the model's threshold.

Songs nobody has checked yet are queued and scanned in the background, so they're filtered the next time
they come up, and the app is told which songs were flagged since it last asked.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import sqlite3
import threading
import time
from datetime import datetime, timezone

import requests

from ai_detector.sources import SOUL_OVER_AI_CREDIT, SOUL_OVER_AI_URL
from recommendation_service import DB_PATH, VIDEO_ID_RE

log = logging.getLogger(__name__)

ARTIST_LIST_PATH = os.environ.get("OHMWAVE_AI_ARTISTS", "models/ai_artists.json")
ARTIST_LIST_MAX_AGE = 24 * 3600
SCAN_WORKERS = 2
MAX_QUEUE = 500


def _now():
    return datetime.now(timezone.utc).isoformat()


class AIFilterService:
    def __init__(self, db_path=DB_PATH, scraper=None, model_path=None, autostart=True):
        self.db_path = db_path
        self.scraper = scraper
        self.model = self._load_model(model_path)
        self.ai_channels = set()
        self._queue = queue.Queue(maxsize=MAX_QUEUE)
        self._queued = set()
        self._lock = threading.Lock()
        self._init_db()
        self._load_artist_list(refresh=autostart)
        if autostart and scraper is not None and self.model is not None:
            for _ in range(SCAN_WORKERS):
                threading.Thread(target=self._scan_worker, daemon=True).start()

    # ------------------------------------------------------------- storage

    def _connect(self):
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self):
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS ai_verdicts (
                    video_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT '',
                    artist TEXT NOT NULL DEFAULT '',
                    artist_id TEXT,
                    album TEXT NOT NULL DEFAULT '',
                    cover TEXT,
                    duration TEXT NOT NULL DEFAULT '',
                    probability REAL,               -- detector score, if scanned
                    model_version TEXT,
                    user_verdict TEXT,              -- 'ai' | 'human' | NULL (you decided)
                    is_ai INTEGER NOT NULL DEFAULT 0,
                    reason TEXT,                    -- 'you' | 'listed' | 'model'
                    error TEXT,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_ai_verdicts_flagged ON ai_verdicts(is_ai, updated_at);
                CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)

    # -------------------------------------------------------------- inputs

    @staticmethod
    def _load_model(path):
        try:
            from ai_detector.model import MODEL_PATH, AIMusicModel
            path = path or MODEL_PATH
            if not os.path.exists(path):
                log.info("No trained AI-music model at %s; only the artist list and your choices are used.", path)
                return None
            model = AIMusicModel.load(path)
            log.info("Loaded AI-music model %s", model.version)
            return model
        except Exception as exc:
            log.warning("Couldn't load the AI-music model: %s", exc)
            return None

    def _load_artist_list(self, refresh=True):
        """Read the cached Soul Over AI list; refresh it in the background when it's a day old."""
        try:
            with open(ARTIST_LIST_PATH) as handle:
                self.ai_channels = set(json.load(handle)["channels"])
            fresh = time.time() - os.path.getmtime(ARTIST_LIST_PATH) < ARTIST_LIST_MAX_AGE
        except (OSError, ValueError, KeyError):
            fresh = False
        if refresh and not fresh:
            threading.Thread(target=self._refresh_artist_list, daemon=True).start()

    def _refresh_artist_list(self):
        try:
            artists = requests.get(SOUL_OVER_AI_URL, timeout=30).json()
            channels = sorted({a["youtube"] for a in artists if a.get("youtube") and not a.get("removed")
                               and a.get("disclosure") != "partial"})
            os.makedirs(os.path.dirname(ARTIST_LIST_PATH) or ".", exist_ok=True)
            with open(ARTIST_LIST_PATH, "w") as handle:
                json.dump({"credit": SOUL_OVER_AI_CREDIT, "updated_at": _now(), "channels": channels}, handle)
            self.ai_channels = set(channels)
            log.info("AI artist list updated: %d artists", len(channels))
        except Exception as exc:
            log.warning("Couldn't update the AI artist list: %s", exc)

    # ------------------------------------------------------------ settings

    def enabled(self):
        with self._connect() as db:
            row = db.execute("SELECT value FROM app_settings WHERE key = 'ai_filter'").fetchone()
        return row is None or row["value"] == "on"  # on by default

    def set_enabled(self, on):
        with self._connect() as db:
            db.execute("INSERT INTO app_settings (key, value) VALUES ('ai_filter', ?) "
                       "ON CONFLICT(key) DO UPDATE SET value = excluded.value", ("on" if on else "off",))

    # ------------------------------------------------------------ verdicts

    def _verdicts(self, video_ids):
        ids = [v for v in video_ids if v]
        if not ids:
            return {}
        with self._connect() as db:
            rows = db.execute(f"SELECT * FROM ai_verdicts WHERE video_id IN ({','.join('?' * len(ids))})", ids).fetchall()
        return {row["video_id"]: row for row in rows}

    def classify(self, track, verdict_row=None):
        """'ai' or 'human' with a reason, or None when the song hasn't been checked yet."""
        if verdict_row is not None and verdict_row["user_verdict"]:
            return verdict_row["user_verdict"], "you"
        if track.get("artistId") and track["artistId"] in self.ai_channels:
            return "ai", "listed"
        if verdict_row is not None and verdict_row["probability"] is not None and self.model is not None \
                and verdict_row["model_version"] == self.model.version:
            return ("ai" if self.model.is_ai(verdict_row["probability"]) else "human"), "model"
        return None

    def filter_tracks(self, tracks):
        """Drop AI songs from a list of track dicts, queueing unchecked ones for a scan. Returns (kept, hidden)."""
        if not tracks or not self.enabled():
            return tracks, 0
        rows = self._verdicts([t.get("videoId") for t in tracks if isinstance(t, dict)])
        kept, hidden = [], 0
        for track in tracks:
            video_id = track.get("videoId") if isinstance(track, dict) else None
            if not video_id or not VIDEO_ID_RE.match(str(video_id)):
                kept.append(track)  # local files and odd items aren't ours to judge
                continue
            verdict = self.classify(track, rows.get(video_id))
            if verdict and verdict[0] == "ai":
                hidden += 1
                if verdict[1] == "listed" and video_id not in rows:
                    self._record(track, is_ai=True, reason="listed")
                continue
            if verdict is None:
                self.enqueue(track)
            kept.append(track)
        return kept, hidden

    def flagged_since(self, since=None, limit=500):
        """Songs found to be AI (most recent first), for the app to drop from what it's showing."""
        with self._connect() as db:
            rows = db.execute("SELECT * FROM ai_verdicts WHERE is_ai = 1 AND updated_at > ? ORDER BY updated_at DESC LIMIT ?",
                              (since or "", int(limit))).fetchall()
        return [self._public(row) for row in rows]

    def mark(self, track, verdict):
        """Your decision for a song: 'ai' hides it, 'human' shows it again whatever the detector says."""
        if verdict not in ("ai", "human"):
            raise ValueError("Verdict must be 'ai' or 'human'.")
        if not VIDEO_ID_RE.match(str(track.get("videoId") or "")):
            raise ValueError("Only YouTube Music songs can be marked.")
        self._record(track, is_ai=verdict == "ai", reason="you", user_verdict=verdict)
        with self._connect() as db:
            return self._public(db.execute("SELECT * FROM ai_verdicts WHERE video_id = ?", (track["videoId"],)).fetchone())

    def status(self):
        with self._connect() as db:
            counts = db.execute("SELECT COUNT(*) AS checked, SUM(is_ai) AS flagged FROM ai_verdicts").fetchone()
        return {
            "enabled": self.enabled(),
            "model": self.model.info if self.model else None,
            "known_ai_artists": len(self.ai_channels),
            "checked": counts["checked"] or 0,
            "hidden": counts["flagged"] or 0,
            "queued": self._queue.qsize(),
            "credit": SOUL_OVER_AI_CREDIT,
        }

    # ------------------------------------------------------------- scanning

    def enqueue(self, track):
        if self.model is None or self.scraper is None:
            return
        video_id = track["videoId"]
        with self._lock:
            if video_id in self._queued:
                return
            try:
                self._queue.put_nowait(dict(track))
                self._queued.add(video_id)
            except queue.Full:
                pass  # it will be queued again next time it shows up

    def scan(self, track):
        """Score one song's audio with the detector and store the verdict."""
        from ai_detector.audio import fetch_clip
        from ai_detector.features import fakeprint
        try:
            probability = self.model.probability(fakeprint(fetch_clip(self.scraper, track["videoId"])))
            self._record(track, is_ai=self.model.is_ai(probability), reason="model", probability=probability)
        except Exception as exc:
            log.info("AI scan failed for %s: %s", track.get("videoId"), exc)
            self._record(track, is_ai=False, reason=None, error=str(exc)[:300])

    def _scan_worker(self):
        while True:
            track = self._queue.get()
            try:
                row = self._verdicts([track["videoId"]]).get(track["videoId"])
                if self.classify(track, row) is None and not (row and row["error"] and row["model_version"] == self.model.version):
                    self.scan(track)
            finally:
                with self._lock:
                    self._queued.discard(track["videoId"])
                self._queue.task_done()

    def _record(self, track, is_ai, reason, probability=None, user_verdict=None, error=None):
        with self._connect() as db:
            existing = db.execute("SELECT user_verdict, probability FROM ai_verdicts WHERE video_id = ?", (track["videoId"],)).fetchone()
            if existing and existing["user_verdict"] and reason != "you":
                return  # never override your own decision
            db.execute("""
                INSERT INTO ai_verdicts (video_id, title, artist, artist_id, album, cover, duration, probability, model_version,
                                         user_verdict, is_ai, reason, error, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(video_id) DO UPDATE SET
                    probability = COALESCE(excluded.probability, ai_verdicts.probability),
                    model_version = COALESCE(excluded.model_version, ai_verdicts.model_version),
                    user_verdict = excluded.user_verdict, is_ai = excluded.is_ai, reason = excluded.reason,
                    error = excluded.error, updated_at = excluded.updated_at
            """, (
                track["videoId"], str(track.get("title") or "")[:300], str(track.get("artist") or "")[:300], track.get("artistId"),
                str(track.get("album") or "")[:300],
                track.get("cover") if str(track.get("cover") or "").startswith("https://") else None,
                str(track.get("duration") or "")[:16], probability,
                self.model.version if self.model and (probability is not None or error) else None,
                user_verdict, int(bool(is_ai)), reason, error, _now(),
            ))

    @staticmethod
    def _public(row):
        return {
            "id": row["video_id"], "videoId": row["video_id"], "title": row["title"], "artist": row["artist"],
            "album": row["album"], "cover": row["cover"], "duration": row["duration"],
            "ai": {"reason": row["reason"], "probability": row["probability"], "flagged_at": row["updated_at"],
                   "yours": bool(row["user_verdict"])},
        }
