"""
User playlists, stored next to listening history in the OhmWaves SQLite database.

A playlist is an ordered list of unique tracks. Track metadata (title, artist, cover...) is copied in when a song
is added, so playlists show and play without asking YouTube Music again, and the phone app can cache them offline.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

from recommendation_service import DB_PATH, VIDEO_ID_RE

MAX_NAME_LENGTH = 100
MAX_TRACKS_PER_REQUEST = 500
MAX_TRACKS_PER_PLAYLIST = 5000


class PlaylistNotFound(LookupError):
    """The playlist doesn't exist, or belongs to someone else (both look the same to the caller)."""


def _now():
    return datetime.now(timezone.utc).isoformat()


def clean_name(name):
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Give your playlist a name.")
    name = " ".join(name.split())
    if len(name) > MAX_NAME_LENGTH:
        raise ValueError(f"Playlist names can be up to {MAX_NAME_LENGTH} characters.")
    return name


def clean_track(track):
    """Keep only the fields a playlist stores, refusing anything that isn't a playable YouTube track."""
    if not isinstance(track, dict):
        raise ValueError("Each track must be an object.")
    video_id = str(track.get("videoId") or "")
    if not VIDEO_ID_RE.match(video_id):
        raise ValueError("Only songs from YouTube Music can be added to a playlist.")
    title = str(track.get("title") or "").strip()
    if not title:
        raise ValueError("Each track needs a title.")
    cover = track.get("cover")
    return {
        "videoId": video_id,
        "title": title[:300],
        "artist": str(track.get("artist") or "")[:300],
        "album": str(track.get("album") or "")[:300],
        "cover": cover[:2048] if isinstance(cover, str) and cover.startswith("https://") else None,
        "duration": str(track.get("duration") or "")[:16],
    }


class PlaylistService:
    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _connect(self):
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _init_db(self):
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS playlists (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS playlist_tracks (
                    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                    video_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    artist TEXT NOT NULL DEFAULT '',
                    album TEXT NOT NULL DEFAULT '',
                    cover TEXT,
                    duration TEXT NOT NULL DEFAULT '',
                    added_at TEXT NOT NULL,
                    PRIMARY KEY (playlist_id, video_id)
                );
                CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id, updated_at);
                CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order ON playlist_tracks(playlist_id, position);
            """)

    # ------------------------------------------------------------------ reads

    def list_playlists(self, user_id):
        """All of a user's playlists with their tracks, most recently changed first."""
        with self._connect() as db:
            rows = db.execute("SELECT * FROM playlists WHERE user_id = ? ORDER BY updated_at DESC",
                              (str(user_id),)).fetchall()
            return [self._with_tracks(db, row) for row in rows]

    def get(self, user_id, playlist_id):
        with self._connect() as db:
            return self._with_tracks(db, self._owned(db, user_id, playlist_id))

    # ----------------------------------------------------------------- writes

    def create(self, user_id, name, tracks=()):
        name = clean_name(name)
        cleaned = self._clean_tracks(tracks)
        playlist_id = uuid.uuid4().hex
        now = _now()
        with self._connect() as db:
            db.execute("INSERT INTO playlists (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                       (playlist_id, str(user_id), name, now, now))
            self._append(db, playlist_id, cleaned, now)
            return self._with_tracks(db, self._owned(db, user_id, playlist_id))

    def rename(self, user_id, playlist_id, name):
        name = clean_name(name)
        with self._connect() as db:
            self._owned(db, user_id, playlist_id)
            db.execute("UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?", (name, _now(), playlist_id))
            return self._with_tracks(db, self._owned(db, user_id, playlist_id))

    def delete(self, user_id, playlist_id):
        with self._connect() as db:
            self._owned(db, user_id, playlist_id)
            db.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))

    def add_tracks(self, user_id, playlist_id, tracks):
        """Append tracks, skipping ones already in the playlist. Returns (playlist, number added)."""
        cleaned = self._clean_tracks(tracks)
        if not cleaned:
            raise ValueError("Choose at least one song to add.")
        with self._connect() as db:
            self._owned(db, user_id, playlist_id)
            now = _now()
            added = self._append(db, playlist_id, cleaned, now)
            if added:
                db.execute("UPDATE playlists SET updated_at = ? WHERE id = ?", (now, playlist_id))
            return self._with_tracks(db, self._owned(db, user_id, playlist_id)), added

    def remove_track(self, user_id, playlist_id, video_id):
        with self._connect() as db:
            self._owned(db, user_id, playlist_id)
            removed = db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ? AND video_id = ?",
                                 (playlist_id, str(video_id))).rowcount
            if removed:
                db.execute("UPDATE playlists SET updated_at = ? WHERE id = ?", (_now(), playlist_id))
            return self._with_tracks(db, self._owned(db, user_id, playlist_id))

    # ---------------------------------------------------------------- helpers

    @staticmethod
    def _clean_tracks(tracks):
        if not isinstance(tracks, (list, tuple)):
            raise ValueError("Tracks must be a list.")
        if len(tracks) > MAX_TRACKS_PER_REQUEST:
            raise ValueError(f"Add up to {MAX_TRACKS_PER_REQUEST} songs at a time.")
        unique = {}
        for track in tracks:
            cleaned = clean_track(track)
            unique.setdefault(cleaned["videoId"], cleaned)
        return list(unique.values())

    @staticmethod
    def _owned(db, user_id, playlist_id):
        row = db.execute("SELECT * FROM playlists WHERE id = ? AND user_id = ?",
                         (str(playlist_id), str(user_id))).fetchone()
        if not row:
            raise PlaylistNotFound("This playlist doesn’t exist anymore.")
        return row

    @staticmethod
    def _append(db, playlist_id, tracks, now):
        existing = {row["video_id"] for row in
                    db.execute("SELECT video_id FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))}
        new = [t for t in tracks if t["videoId"] not in existing]
        if len(existing) + len(new) > MAX_TRACKS_PER_PLAYLIST:
            raise ValueError(f"A playlist can hold up to {MAX_TRACKS_PER_PLAYLIST} songs.")
        start = db.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?",
                           (playlist_id,)).fetchone()[0]
        db.executemany("""
            INSERT INTO playlist_tracks (playlist_id, video_id, position, title, artist, album, cover, duration, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [(playlist_id, t["videoId"], start + i, t["title"], t["artist"], t["album"], t["cover"], t["duration"], now)
              for i, t in enumerate(new)])
        return len(new)

    @staticmethod
    def _with_tracks(db, row):
        tracks = db.execute("SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position",
                            (row["id"],)).fetchall()
        return {
            "id": row["id"],
            "name": row["name"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "tracks": [{
                "id": t["video_id"], "videoId": t["video_id"], "title": t["title"], "artist": t["artist"],
                "album": t["album"], "cover": t["cover"], "duration": t["duration"], "added_at": t["added_at"],
            } for t in tracks],
        }
