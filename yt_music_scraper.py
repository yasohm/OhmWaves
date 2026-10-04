import os
import sys
import re
import json
import time
import threading
import requests
from pathlib import Path
from ytmusicapi import YTMusic
import yt_dlp
import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, TDRC, ID3NoHeaderError
from mutagen.mp4 import MP4, MP4Cover
from mutagen.flac import FLAC, Picture

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BIN_DIR = os.path.join(BASE_DIR, "bin")
NODE_DIR = "/home/yassin/.nvm/versions/node/v22.23.2/bin"

current_path = os.environ.get("PATH", "")
path_parts = current_path.split(os.path.pathsep)
if BIN_DIR not in path_parts:
    path_parts.insert(0, BIN_DIR)
if os.path.exists(NODE_DIR) and NODE_DIR not in path_parts:
    path_parts.insert(0, NODE_DIR)
os.environ["PATH"] = os.path.pathsep.join(path_parts)

class YTMusicScraper:
    def __init__(self, download_dir="downloads"):
        self.ytmusic = YTMusic()
        self.download_dir = os.path.abspath(download_dir)
        os.makedirs(self.download_dir, exist_ok=True)
        self.bin_dir = BIN_DIR if os.path.exists(BIN_DIR) else None
        self._stream_cache = {}
        self._stream_lock = threading.Lock()
        self._stream_resolving = {}

    def search_artist(self, artist_name, limit=10):
        """Search for an artist and get top songs and albums."""
        try:
            results = self.ytmusic.search(artist_name, filter="artists", limit=limit)
            artists_data = []

            for item in results[:limit]:
                browse_id = item.get("browseId")
                artist_info = {
                    "type": "artist",
                    "id": browse_id,
                    "name": item.get("artist"),
                    "subscribers": item.get("subscribers", ""),
                    "thumbnails": item.get("thumbnails", []),
                    "songs": [],
                    "albums": []
                }

                if browse_id:
                    try:
                        details = self.ytmusic.get_artist(browse_id)

                        if "songs" in details and "results" in details["songs"]:
                            for s in details["songs"]["results"]:
                                artist_info["songs"].append(self._parse_song_item(s, fallback_artist=item.get("artist")))

                        if "albums" in details and "results" in details["albums"]:
                            for alb in details["albums"]["results"]:
                                artist_info["albums"].append({
                                    "id": alb.get("browseId"),
                                    "title": alb.get("title"),
                                    "year": alb.get("year", ""),
                                    "type": alb.get("type", "Album"),
                                    "thumbnails": alb.get("thumbnails", [])
                                })
                    except Exception as err:
                        print(f"Error fetching detailed artist data for {browse_id}: {err}")

                artists_data.append(artist_info)

            if not artists_data:
                song_results = self.ytmusic.search(artist_name, filter="songs", limit=limit)
                tracks = [self._parse_song_item(s) for s in song_results]
                return {
                    "query": artist_name,
                    "type": "artist",
                    "artists": [{
                        "name": artist_name,
                        "type": "artist",
                        "id": None,
                        "songs": tracks,
                        "albums": []
                    }]
                }

            return {
                "query": artist_name,
                "type": "artist",
                "artists": artists_data
            }
        except Exception as e:
            print(f"Artist search error: {e}")
            return self._fallback_search(artist_name, limit=limit)

    def search_album(self, album_name, limit=10):
        """Search for albums and return list with track breakdown."""
        try:
            results = self.ytmusic.search(album_name, filter="albums", limit=limit)
            albums_data = []

            for item in results[:limit]:
                browse_id = item.get("browseId")
                album_info = {
                    "type": "album",
                    "id": browse_id,
                    "title": item.get("title"),
                    "artist": self._extract_artist_name(item.get("artists")),
                    "artistId": self._first_artist_id(item.get("artists")),
                    "year": item.get("year", ""),
                    "thumbnails": item.get("thumbnails", []),
                    "tracks": []
                }

                if browse_id:
                    try:
                        tracks_detail = self.get_album_tracks(browse_id)
                        album_info["tracks"] = tracks_detail.get("tracks", [])
                    except Exception as err:
                        print(f"Error fetching album tracks for {browse_id}: {err}")

                albums_data.append(album_info)

            return {
                "query": album_name,
                "type": "album",
                "albums": albums_data
            }
        except Exception as e:
            print(f"Album search error: {e}")
            return {"query": album_name, "type": "album", "albums": []}

    def get_album_tracks(self, browse_id):
        """Fetch all tracks inside an album by browseId."""
        try:
            album_data = self.ytmusic.get_album(browse_id)
            album_title = album_data.get("title", "Unknown Album")
            artist_name = self._extract_artist_name(album_data.get("artists"))
            thumbnails = album_data.get("thumbnails", [])
            year = album_data.get("year", "")

            tracks = []
            for track in album_data.get("tracks", []):
                vid = track.get("videoId")
                if vid:
                    tracks.append({
                        "id": vid,
                        "title": track.get("title"),
                        "artist": self._extract_artist_name(track.get("artists")) or artist_name,
                        "artistId": self._first_artist_id(track.get("artists")) or self._first_artist_id(album_data.get("artists")),
                        "album": album_title,
                        "duration": track.get("duration", ""),
                        "duration_seconds": track.get("duration_seconds", 0),
                        "thumbnails": thumbnails,
                        "cover": self.best_thumbnail(thumbnails),
                        "year": year,
                        "videoId": vid,
                        "url": f"https://www.youtube.com/watch?v={vid}"
                    })

            return {
                "id": browse_id,
                "title": album_title,
                "artist": artist_name,
                "year": year,
                "thumbnails": thumbnails,
                "tracks": tracks
            }
        except Exception as e:
            print(f"Get album tracks error: {e}")
            return {"tracks": []}

    def search_genre(self, genre_name, limit=15):
        """Search music by genre (returns tracks & featured playlists)."""
        try:
            song_results = self.ytmusic.search(f"{genre_name} music", filter="songs", limit=limit)
            songs = [self._parse_song_item(s) for s in song_results]

            playlist_results = self.ytmusic.search(genre_name, filter="playlists", limit=5)
            playlists = []
            for pl in playlist_results:
                playlists.append({
                    "id": pl.get("browseId"),
                    "title": pl.get("title"),
                    "itemCount": pl.get("itemCount", ""),
                    "thumbnails": pl.get("thumbnails", [])
                })

            return {
                "query": genre_name,
                "type": "genre",
                "songs": songs,
                "playlists": playlists
            }
        except Exception as e:
            print(f"Genre search error: {e}")
            return self._fallback_search(f"{genre_name} music", limit=limit)

    def search_tracks(self, query, limit=15):
        """General music search returning tracks."""
        try:
            song_results = self.ytmusic.search(query, filter="songs", limit=limit)
            songs = [self._parse_song_item(s) for s in song_results]

            if not songs:
                general = self.ytmusic.search(query, limit=limit)
                for item in general:
                    if item.get("resultType") in ["song", "video"] and item.get("videoId"):
                        songs.append(self._parse_song_item(item))

            return {
                "query": query,
                "type": "track",
                "songs": songs
            }
        except Exception as e:
            print(f"Track search error: {e}")
            return self._fallback_search(query, limit=limit)

    def _parse_song_item(self, item, fallback_artist="Unknown Artist"):
        vid = item.get("videoId")
        artists = item.get("artists")
        artist_name = self._extract_artist_name(artists) or fallback_artist
        album_data = item.get("album")
        album_name = album_data.get("name") if isinstance(album_data, dict) else (item.get("album") or "Single")
        thumbnails = item.get("thumbnails") or item.get("thumbnail") or []

        return {
            "id": vid,
            "videoId": vid,
            "title": item.get("title", "Unknown Title"),
            "artist": artist_name,
            "artistId": self._first_artist_id(artists),
            "album": album_name,
            "duration": item.get("duration") or item.get("length") or "",
            "thumbnails": thumbnails,
            "cover": self.best_thumbnail(thumbnails),
            "url": f"https://www.youtube.com/watch?v={vid}" if vid else ""
        }

    @staticmethod
    def best_thumbnail(thumbnails, size=544):
        """Return a crisp artwork URL, upscaling Google-hosted square thumbnails."""
        if not thumbnails:
            return None
        url = thumbnails[-1].get("url") if isinstance(thumbnails[-1], dict) else None
        if url and "googleusercontent.com" in url:
            url = re.sub(r"=w\d+-h\d+", f"=w{size}-h{size}", url)
            url = re.sub(r"=s\d+$", f"=s{size}", url)
        return url

    # --- Catalog helpers used by the recommendation engine -----------------

    def get_related_tracks(self, video_id, limit=25):
        """YouTube Music radio for a track: the strongest item-to-item signal available."""
        data = self.ytmusic.get_watch_playlist(videoId=video_id, radio=True, limit=limit)
        return [self._parse_song_item(t) for t in data.get("tracks", [])
                if t.get("videoId") and t.get("videoId") != video_id]

    def get_artist_top_tracks(self, artist_name, limit=10):
        """Popular songs whose primary artist matches ``artist_name``."""
        wanted = artist_name.strip().lower()
        results = self.ytmusic.search(artist_name, filter="songs", limit=limit * 2)
        songs = [self._parse_song_item(s) for s in results if s.get("videoId")]
        matching = [s for s in songs if s["artist"].split(",")[0].strip().lower() == wanted]
        return (matching or songs)[:limit]

    def get_trending_tracks(self, limit=25, country="ZZ"):
        """Global chart tracks for cold-start recommendations."""
        try:
            charts = self.ytmusic.get_charts(country)
            playlist_id = next((p.get("playlistId") for p in charts.get("videos", []) if p.get("playlistId")), None)
            if playlist_id:
                playlist = self.ytmusic.get_playlist(playlist_id, limit=limit)
                tracks = [self._parse_song_item(t) for t in playlist.get("tracks", []) if t.get("videoId")]
                if tracks:
                    return tracks[:limit]
        except Exception as err:
            print(f"Charts error: {err}")
        results = self.ytmusic.search("top hits this week", filter="songs", limit=limit)
        return [self._parse_song_item(s) for s in results if s.get("videoId")][:limit]

    @staticmethod
    def read_embedded_artwork(filepath):
        """Return (bytes, mime) for cover art embedded in a local audio file, or None."""
        try:
            audio = mutagen.File(filepath)
        except Exception:
            return None
        if audio is None:
            return None
        pictures = getattr(audio, "pictures", None)
        if pictures:
            return pictures[0].data, pictures[0].mime or "image/jpeg"
        tags = audio.tags
        if tags is None:
            return None
        if hasattr(tags, "getall"):
            frames = tags.getall("APIC")
            if frames:
                return frames[0].data, frames[0].mime or "image/jpeg"
        covers = tags.get("covr") if hasattr(tags, "get") else None
        if covers:
            cover = covers[0]
            mime = "image/png" if getattr(cover, "imageformat", None) == MP4Cover.FORMAT_PNG else "image/jpeg"
            return bytes(cover), mime
        return None

    # --- Instant streaming -------------------------------------------------

    def resolve_stream(self, video_id, force=False):
        """Resolve (and cache) a direct audio URL so tracks play without downloading."""
        with self._stream_lock:
            track_lock = self._stream_resolving.setdefault(video_id, threading.Lock())
        # A play request that arrives mid-prefetch waits for that result instead of re-running yt-dlp.
        with track_lock:
            try:
                return self._resolve_stream_locked(video_id, force)
            finally:
                with self._stream_lock:
                    self._stream_resolving.pop(video_id, None)

    def _resolve_stream_locked(self, video_id, force):
        now = time.time()
        with self._stream_lock:
            cached = self._stream_cache.get(video_id)
            if cached and not force and cached["expires_at"] > now:
                return cached
        ydl_opts = {
            "format": "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio",
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "js_runtimes": {"node": {}},
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        expire_match = re.search(r"[?&]expire=(\d+)", info["url"])
        expires_at = int(expire_match.group(1)) - 300 if expire_match else now + 3 * 3600
        entry = {
            "url": info["url"],
            "headers": dict(info.get("http_headers") or {}),
            "mime": f"audio/{'mp4' if info.get('ext') == 'm4a' else info.get('ext', 'webm')}",
            "expires_at": expires_at,
        }
        with self._stream_lock:
            if len(self._stream_cache) > 500:
                self._stream_cache = {k: v for k, v in self._stream_cache.items() if v["expires_at"] > now}
            self._stream_cache[video_id] = entry
        return entry

    @staticmethod
    def _first_artist_id(artists):
        """The main artist's YouTube channel id (used to recognise known AI artists)."""
        if isinstance(artists, list):
            for artist in artists:
                if isinstance(artist, dict) and str(artist.get("id") or "").startswith("UC"):
                    return artist["id"]
        return None

    def _extract_artist_name(self, artists):
        if isinstance(artists, list) and len(artists) > 0:
            return ", ".join([a.get("name", "") for a in artists if a.get("name")])
        elif isinstance(artists, str):
            return artists
        return ""

    def _fallback_search(self, query, limit=10):
        """Fallback to yt-dlp search if ytmusicapi fails."""
        ydl_opts = {
            "extract_flat": "in_playlist",
            "skip_download": True,
            "quiet": True,
            "js_runtimes": {"node": {}}
        }
        songs = []
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                res = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
                if res and "entries" in res:
                    for entry in res["entries"]:
                        songs.append({
                            "id": entry.get("id"),
                            "videoId": entry.get("id"),
                            "title": entry.get("title", "Unknown"),
                            "artist": entry.get("uploader", "Unknown Artist"),
                            "album": "YouTube Audio",
                            "duration": str(entry.get("duration", "")),
                            "thumbnails": [{"url": entry.get("thumbnail")}] if entry.get("thumbnail") else [],
                            "url": entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id')}"
                        })
        except Exception as e:
            print(f"Fallback search error: {e}")
        return {"query": query, "type": "fallback", "songs": songs}

    def sanitize_filename(self, name):
        """Remove invalid characters from filenames."""
        return re.sub(r'[\\/*?:"<>|]', "", name).strip()

    def download_track(self, video_id_or_url, output_subfolder="", audio_format="mp3", audio_quality="320", metadata=None, progress_callback=None):
        """
        Download YouTube video audio, convert to specified format, and embed ID3 tags.
        """
        url = video_id_or_url if video_id_or_url.startswith("http") else f"https://www.youtube.com/watch?v={video_id_or_url}"

        target_dir = os.path.join(self.download_dir, output_subfolder) if output_subfolder else self.download_dir
        os.makedirs(target_dir, exist_ok=True)

        out_tmpl = os.path.join(target_dir, "%(title)s.%(ext)s")

        def _yt_hook(d):
            if progress_callback and callable(progress_callback):
                if d["status"] == "downloading":
                    total = d.get("total_bytes") or d.get("total_bytes_estimate") or 1
                    downloaded = d.get("downloaded_bytes", 0)
                    percent = min(100.0, (downloaded / total) * 100)
                    speed = d.get("speed", 0)
                    progress_callback({
                        "status": "downloading",
                        "percent": round(percent, 1),
                        "downloaded": downloaded,
                        "total": total,
                        "speed": speed,
                        "eta": d.get("eta")
                    })
                elif d["status"] == "finished":
                    progress_callback({
                        "status": "converting",
                        "percent": 95.0,
                        "message": "Converting audio & embedding tags..."
                    })

        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": out_tmpl,
            "quiet": True,
            "no_warnings": True,
            "nocheckcertificate": True,
            "concurrent_fragment_downloads": 8,
            "buffersize": 1048576,
            "http_chunk_size": 10485760,
            "js_runtimes": {"node": {}},
            "progress_hooks": [_yt_hook],
            "postprocessor_args": {
                "ffmpeg": ["-threads", "4"]
            },
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": audio_format if audio_format in ["mp3", "m4a", "flac", "wav", "opus"] else "mp3",
                "preferredquality": audio_quality if audio_quality in ["320", "256", "192", "128"] else "320",
            }]
        }

        if self.bin_dir:
            ydl_opts["ffmpeg_location"] = self.bin_dir

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                title = info.get("title", "track")
                clean_title = self.sanitize_filename(title)

                ext = audio_format if audio_format in ["mp3", "m4a", "flac", "wav", "opus"] else "mp3"
                filename = f"{clean_title}.{ext}"
                filepath = os.path.join(target_dir, filename)

                if not os.path.exists(filepath):
                    for f in os.listdir(target_dir):
                        if f.endswith(f".{ext}"):
                            filepath = os.path.join(target_dir, f)
                            filename = f
                            break

                meta = metadata or {}
                track_title = meta.get("title") or title
                artist_name = meta.get("artist") or info.get("uploader") or "Unknown Artist"
                album_name = meta.get("album") or "YouTube Audio"
                year_str = str(meta.get("year") or "")
                thumbnail_url = meta.get("thumbnail") or info.get("thumbnail")

                if os.path.exists(filepath):
                    self._embed_metadata(filepath, track_title, artist_name, album_name, year_str, thumbnail_url, ext)

                if progress_callback and callable(progress_callback):
                    progress_callback({
                        "status": "completed",
                        "percent": 100.0,
                        "filepath": filepath,
                        "filename": filename,
                        "title": track_title,
                        "artist": artist_name,
                        "album": album_name
                    })

                return {
                    "success": True,
                    "filepath": filepath,
                    "filename": filename,
                    "title": track_title,
                    "artist": artist_name,
                    "album": album_name,
                    "ext": ext
                }
        except Exception as e:
            print(f"Download failed for {url}: {e}")
            if progress_callback and callable(progress_callback):
                progress_callback({
                    "status": "error",
                    "error": str(e)
                })
            return {"success": False, "error": str(e)}

    def _embed_metadata(self, filepath, title, artist, album, year, thumbnail_url, ext):
        """Embed tags and album art into MP3, M4A, FLAC."""
        try:
            img_data = None
            if thumbnail_url:
                try:
                    res = requests.get(thumbnail_url, timeout=10)
                    if res.status_code == 200:
                        img_data = res.content
                except Exception as err:
                    print(f"Could not download thumbnail image: {err}")

            if ext == "mp3":
                try:
                    audio = ID3(filepath)
                except ID3NoHeaderError:
                    audio = ID3()

                audio.add(TIT2(encoding=3, text=title))
                audio.add(TPE1(encoding=3, text=artist))
                audio.add(TALB(encoding=3, text=album))
                if year:
                    audio.add(TDRC(encoding=3, text=year))

                if img_data:
                    audio.add(APIC(
                        encoding=3,
                        mime="image/jpeg",
                        type=3,
                        desc="Cover",
                        data=img_data
                    ))
                audio.save(filepath)

            elif ext == "m4a":
                audio = MP4(filepath)
                audio["\xa9nam"] = [title]
                audio["\xa9ART"] = [artist]
                audio["\xa9alb"] = [album]
                if year:
                    audio["\xa9day"] = [year]
                if img_data:
                    audio["covr"] = [MP4Cover(img_data, imageformat=MP4Cover.FORMAT_JPEG)]
                audio.save()

            elif ext == "flac":
                audio = FLAC(filepath)
                audio["title"] = title
                audio["artist"] = artist
                audio["album"] = album
                if year:
                    audio["date"] = year
                if img_data:
                    pic = Picture()
                    pic.type = 3
                    pic.mime = "image/jpeg"
                    pic.desc = "Cover"
                    pic.data = img_data
                    audio.add_picture(pic)
                audio.save()

        except Exception as e:
            print(f"Error tagging metadata on {filepath}: {e}")
