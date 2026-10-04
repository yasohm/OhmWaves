import os
import sys
import uuid
from datetime import datetime, timezone
import threading
import time
import requests
from flask import Flask, Response, render_template, request, jsonify, send_file, send_from_directory, stream_with_context
from werkzeug.security import safe_join
from yt_music_scraper import YTMusicScraper
from recommendation_service import RecommendationService, VIDEO_ID_RE
from playlist_service import PlaylistNotFound, PlaylistService
from ai_filter_service import AIFilterService

app = Flask(__name__)

@app.after_request
def add_mobile_cors_headers(response):
    # Capacitor serves the UI from capacitor://localhost on native devices.
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Range"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Expose-Headers"] = "Content-Length, Content-Range, Accept-Ranges"
    return response

scraper = YTMusicScraper(download_dir="downloads")
recommendations = RecommendationService(catalog=scraper)
playlists = PlaylistService()
ai_filter = AIFilterService(scraper=scraper)


def api_error(message, code="VALIDATION_ERROR", status=400):
    return jsonify({"success": False, "error": {"code": code, "message": message}}), status


def api_ok(data, status=200):
    return jsonify({"success": True, "data": data}), status


def valid_user_id(user_id):
    return bool(user_id) and len(user_id) <= 64 and user_id.replace("-", "").replace("_", "").isalnum()


def library_path(relative_path):
    """Resolve a library path, refusing anything that escapes the downloads folder."""
    if not relative_path:
        return None
    return safe_join(scraper.download_dir, relative_path)

download_jobs = {}

@app.route("/api/events", methods=["POST"])
def record_listening_event():
    try:
        recommendations.record_event(request.get_json() or {})
        return jsonify({"success": True}), 201
    except (TypeError, ValueError) as exc:
        return jsonify({"success": False, "error": {"code": "VALIDATION_ERROR", "message": str(exc)}}), 400

@app.route("/api/likes", methods=["POST"])
def save_user_like():
    try:
        recommendations.set_like(request.get_json() or {})
        return jsonify({"success": True}), 201
    except (TypeError, ValueError) as exc:
        return jsonify({"success": False, "error": {"code": "VALIDATION_ERROR", "message": str(exc)}}), 400

@app.route("/api/likes", methods=["DELETE"])
def remove_user_like():
    try:
        recommendations.remove_like(request.get_json() or {})
        return jsonify({"success": True})
    except (TypeError, ValueError) as exc:
        return api_error(str(exc))

@app.route("/api/likes/<user_id>", methods=["GET"])
def list_user_likes(user_id):
    if not valid_user_id(user_id):
        return api_error("Invalid user id")
    return api_ok({"tracks": recommendations.list_likes(user_id)})

# ------------------------------------------------------------------ playlists
# Every call names the user, like likes do; the playlist must belong to that user.

def _playlist_call(action):
    """Run a playlist operation, turning validation and ownership problems into clear API errors."""
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id") or request.args.get("user_id")
    if not valid_user_id(user_id):
        return api_error("Invalid user id")
    try:
        return action(user_id, data)
    except PlaylistNotFound as exc:
        return api_error(str(exc), "NOT_FOUND", 404)
    except (TypeError, ValueError) as exc:
        return api_error(str(exc))

@app.route("/api/playlists", methods=["GET"])
def list_playlists():
    return _playlist_call(lambda user_id, _: api_ok({"playlists": playlists.list_playlists(user_id)}))

@app.route("/api/playlists", methods=["POST"])
def create_playlist():
    return _playlist_call(lambda user_id, data: api_ok(
        {"playlist": playlists.create(user_id, data.get("name"), data.get("tracks") or [])}, 201))

@app.route("/api/playlists/<playlist_id>", methods=["PATCH"])
def rename_playlist(playlist_id):
    return _playlist_call(lambda user_id, data: api_ok({"playlist": playlists.rename(user_id, playlist_id, data.get("name"))}))

@app.route("/api/playlists/<playlist_id>", methods=["DELETE"])
def delete_playlist(playlist_id):
    def action(user_id, _):
        playlists.delete(user_id, playlist_id)
        return api_ok({"id": playlist_id})
    return _playlist_call(action)

@app.route("/api/playlists/<playlist_id>/tracks", methods=["POST"])
def add_playlist_tracks(playlist_id):
    def action(user_id, data):
        playlist, added = playlists.add_tracks(user_id, playlist_id, data.get("tracks"))
        return api_ok({"playlist": playlist, "added": added})
    return _playlist_call(action)

@app.route("/api/playlists/<playlist_id>/tracks/<video_id>", methods=["DELETE"])
def remove_playlist_track(playlist_id, video_id):
    return _playlist_call(lambda user_id, _: api_ok({"playlist": playlists.remove_track(user_id, playlist_id, video_id)}))

# ------------------------------------------------------------- AI-music filter

def hide_ai(payload):
    """Remove AI-generated songs (and confirmed AI artists or their albums) from any track-bearing response."""
    if not isinstance(payload, dict) or not ai_filter.enabled():
        return payload
    hidden = 0

    def tracks(items, artist_id=None):
        nonlocal hidden
        if artist_id:  # songs on an artist page belong to that artist
            items = [dict(t, artistId=t.get("artistId") or artist_id) for t in items]
        kept, removed = ai_filter.filter_tracks(items)
        hidden += removed
        return kept

    def known_ai(item):
        return bool(item.get("artistId") or item.get("id")) and (item.get("artistId") or item.get("id")) in ai_filter.ai_channels

    for key in ("songs", "tracks", "recommendations"):
        if isinstance(payload.get(key), list):
            payload[key] = tracks(payload[key], payload.get("artistId"))
    if isinstance(payload.get("artists"), list):
        kept_artists = []
        for artist in payload["artists"]:
            if isinstance(artist, dict) and artist.get("type") == "artist" and known_ai(artist):
                hidden += len(artist.get("songs") or []) or 1
                continue
            if isinstance(artist, dict) and isinstance(artist.get("songs"), list):
                artist["songs"] = tracks(artist["songs"], artist.get("id"))
            kept_artists.append(artist)
        payload["artists"] = kept_artists
    if isinstance(payload.get("albums"), list):
        kept_albums = []
        for album in payload["albums"]:
            if isinstance(album, dict) and album.get("artistId") in ai_filter.ai_channels:
                hidden += 1
                continue
            if isinstance(album, dict) and isinstance(album.get("tracks"), list):
                album["tracks"] = tracks(album["tracks"], album.get("artistId"))
            kept_albums.append(album)
        payload["albums"] = kept_albums
    for section in payload.get("sections") or []:
        if isinstance(section, dict) and isinstance(section.get("tracks"), list):
            section["tracks"] = tracks(section["tracks"])
    if hidden:
        payload["ai_hidden"] = payload.get("ai_hidden", 0) + hidden
    return payload

@app.route("/api/ai-filter", methods=["GET"])
def ai_filter_status():
    return api_ok(ai_filter.status())

@app.route("/api/ai-filter", methods=["POST"])
def ai_filter_settings():
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get("enabled"), bool):
        return api_error("Send enabled: true or false.")
    ai_filter.set_enabled(data["enabled"])
    return api_ok(ai_filter.status())

@app.route("/api/ai-filter/flagged", methods=["GET"])
def ai_filter_flagged():
    """Songs found to be AI since `since` (an ISO time), so the app can drop them from what it shows."""
    since = request.args.get("since", "")[:40]
    return api_ok({"tracks": ai_filter.flagged_since(since), "now": datetime.now(timezone.utc).isoformat()})

@app.route("/api/ai-filter/mark", methods=["POST"])
def ai_filter_mark():
    data = request.get_json(silent=True) or {}
    track = data.get("track") if isinstance(data.get("track"), dict) else {}
    try:
        return api_ok({"track": ai_filter.mark(track, data.get("verdict"))})
    except ValueError as exc:
        return api_error(str(exc))

@app.route("/api/home/<user_id>", methods=["GET"])
def get_home(user_id):
    if not valid_user_id(user_id):
        return api_error("Invalid user id")
    return api_ok(hide_ai(recommendations.home(user_id)))

@app.route("/api/recommendations/retrain", methods=["POST"])
def retrain_recommendations():
    return jsonify(recommendations.retrain())

@app.route("/api/recommendations/<user_id>/next", methods=["POST"])
def get_next_tracks(user_id):
    if not valid_user_id(user_id):
        return api_error("Invalid user id")
    data = request.get_json() or {}
    exclude = data.get("exclude") if isinstance(data.get("exclude"), list) else []
    try:
        tracks = recommendations.next_tracks(user_id, data.get("seed") or {}, exclude=exclude[:200],
                                             limit=data.get("limit", 10))
    except (TypeError, ValueError) as exc:
        return api_error(str(exc))
    return api_ok(hide_ai({"tracks": tracks}))

@app.route("/api/recommendations/<user_id>", methods=["GET"])
def get_recommendations(user_id):
    try:
        limit = request.args.get("limit", 20, type=int)
        return jsonify(hide_ai({"user_id": user_id, "recommendations": recommendations.recommend(user_id, limit)}))
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400

STREAM_HEADERS = ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges")

STREAM_UNAVAILABLE = "This track is unavailable right now."
AUDIO_EXTENSIONS = {"audio/mp4": "m4a", "audio/webm": "webm"}

def _open_upstream(video_id, byte_range, force=False):
    info = scraper.resolve_stream(video_id, force=force)
    headers = dict(info["headers"])
    headers["Range"] = byte_range
    return info, requests.get(info["url"], headers=headers, stream=True, timeout=20)

def _connect_audio(video_id, byte_range):
    """Open the track's audio upstream, re-resolving once if the cached URL expired. Returns (info, upstream) or None."""
    try:
        info, upstream = _open_upstream(video_id, byte_range)
        if upstream.status_code in (403, 410):
            upstream.close()
            info, upstream = _open_upstream(video_id, byte_range, force=True)
    except Exception as exc:
        app.logger.warning("Stream resolution failed for %s: %s", video_id, exc)
        return None
    if upstream.status_code >= 400:
        app.logger.warning("Upstream refused %s with HTTP %s", video_id, upstream.status_code)
        upstream.close()
        return None
    return info, upstream

def _relay(upstream, status, headers):
    response = Response(stream_with_context(upstream.iter_content(chunk_size=64 * 1024)),
                        status=status, direct_passthrough=True)
    for header in headers:
        if header in upstream.headers:
            response.headers[header] = upstream.headers[header]
    response.headers["Cache-Control"] = "no-store"
    response.call_on_close(upstream.close)
    return response

@app.route("/api/listen/<video_id>", methods=["GET"])
def listen(video_id):
    """Stream a track instantly by proxying its audio (with Range support for seeking)."""
    if not VIDEO_ID_RE.match(video_id):
        return api_error("Invalid track id")
    connected = _connect_audio(video_id, request.headers.get("Range", "bytes=0-"))
    if not connected:
        return api_error(STREAM_UNAVAILABLE, "STREAM_UNAVAILABLE", 502)
    info, upstream = connected
    response = _relay(upstream, upstream.status_code, STREAM_HEADERS)
    response.headers.setdefault("Content-Type", info["mime"])
    return response

@app.route("/api/offline/<video_id>", methods=["GET"])
def offline_track(video_id):
    """Get a track ready for the phone to save: resolves its audio and says which file type it will be."""
    if not VIDEO_ID_RE.match(video_id):
        return api_error("Invalid track id")
    try:
        info = scraper.resolve_stream(video_id)
    except Exception as exc:
        app.logger.warning("Stream resolution failed for %s: %s", video_id, exc)
        return api_error(STREAM_UNAVAILABLE, "STREAM_UNAVAILABLE", 502)
    return api_ok({"ext": AUDIO_EXTENSIONS.get(info["mime"], "m4a"), "file_url": f"/api/offline/{video_id}/audio"})

@app.route("/api/offline/<video_id>/audio", methods=["GET"])
def offline_track_audio(video_id):
    """
    Phone downloads: relay the whole audio file straight to the phone, which saves it in its own storage.
    Nothing is written on the server.
    """
    if not VIDEO_ID_RE.match(video_id):
        return api_error("Invalid track id")
    connected = _connect_audio(video_id, "bytes=0-")
    if not connected:
        return api_error(STREAM_UNAVAILABLE, "STREAM_UNAVAILABLE", 502)
    info, upstream = connected
    # Always a complete file, even when upstream answers the open range with 206.
    response = _relay(upstream, 200, ("Content-Length",))
    response.headers["Content-Type"] = info["mime"]
    ext = AUDIO_EXTENSIONS.get(info["mime"], "m4a")
    response.headers["Content-Disposition"] = f'attachment; filename="{video_id}.{ext}"'
    return response

@app.route("/api/listen/<video_id>/warm", methods=["POST"])
def warm_stream(video_id):
    """Resolve the next track's stream in the background so skipping is instant."""
    if not VIDEO_ID_RE.match(video_id):
        return api_error("Invalid track id")
    with _warm_lock:
        if video_id in _warming or len(_warming) >= 12:
            return jsonify({"success": True}), 202
        _warming.add(video_id)
    threading.Thread(target=_safe_resolve, args=(video_id,), daemon=True).start()
    return jsonify({"success": True}), 202

# Prefetching is speculative (hover, next in queue), so dedupe it and cap parallel yt-dlp runs.
_warming = set()
_warm_lock = threading.Lock()
_warm_slots = threading.Semaphore(3)

def _safe_resolve(video_id):
    try:
        with _warm_slots:
            scraper.resolve_stream(video_id)
    except Exception as exc:
        app.logger.info("Prefetch failed for %s: %s", video_id, exc)
    finally:
        with _warm_lock:
            _warming.discard(video_id)

@app.route("/")
def index():
    dist_dir = os.path.join(os.path.dirname(__file__), "frontend", "dist")
    if os.path.exists(os.path.join(dist_dir, "index.html")):
        return send_from_directory(dist_dir, "index.html")
    return render_template("index.html")

@app.route("/api/health", methods=["GET"])
def health():
    """Cheap reachability check for the phone app's offline mode."""
    return api_ok({"status": "ok"})

@app.route("/assets/<path:filename>")
def serve_assets(filename):
    assets_dir = os.path.join(os.path.dirname(__file__), "frontend", "dist", "assets")
    if os.path.exists(assets_dir):
        return send_from_directory(assets_dir, filename)
    return jsonify({"error": "Asset not found"}), 404

@app.route("/<any('favicon.svg', 'icon-192.png', 'apple-touch-icon.png'):filename>")
def serve_icon(filename):
    dist_dir = os.path.join(os.path.dirname(__file__), "frontend", "dist")
    return send_from_directory(dist_dir, filename, max_age=86400)

@app.route("/api/search", methods=["POST"])
def search():
    data = request.get_json() or {}
    search_type = data.get("type", "track")
    query = data.get("query", "").strip()

    if not query:
        return jsonify({"error": "Search query is required"}), 400

    if search_type == "artist":
        res = scraper.search_artist(query)
    elif search_type == "album":
        res = scraper.search_album(query)
    elif search_type == "genre":
        res = scraper.search_genre(query)
    else:
        res = scraper.search_tracks(query)

    return jsonify(hide_ai(res))

@app.route("/api/album/<browse_id>", methods=["GET"])
def get_album(browse_id):
    res = scraper.get_album_tracks(browse_id)
    return jsonify(hide_ai(res))

@app.route("/api/download", methods=["POST"])
def start_download():
    data = request.get_json() or {}
    tracks = data.get("tracks", [])
    audio_format = data.get("format", "mp3")
    audio_quality = data.get("quality", "320")

    if not tracks:
        return jsonify({"error": "No tracks provided for download"}), 400

    job_id = str(uuid.uuid4())
    download_jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "total": len(tracks),
        "current_index": 0,
        "completed": 0,
        "current_track": "",
        "current_percent": 0.0,
        "files": [],
        "errors": []
    }

    thread = threading.Thread(target=process_download_job, args=(job_id, tracks, audio_format, audio_quality))
    thread.daemon = True
    thread.start()

    return jsonify({"job_id": job_id, "status": "started", "total": len(tracks)})

from concurrent.futures import ThreadPoolExecutor

def process_download_job(job_id, tracks, audio_format, audio_quality):
    job = download_jobs.get(job_id)
    if not job:
        return

    job["status"] = "in_progress"
    completed_lock = threading.Lock()

    def download_single(item):
        idx, track = item
        track_title = track.get("title", "Track")
        artist_name = track.get("artist", "Artist")
        album_name = track.get("album", "")

        with completed_lock:
            job["current_track"] = f"{track_title} - {artist_name}"

        subfolder = ""
        if artist_name and artist_name != "Unknown Artist":
            subfolder = scraper.sanitize_filename(artist_name)
            if album_name and album_name not in ["YouTube Audio", "Single"]:
                subfolder = os.path.join(subfolder, scraper.sanitize_filename(album_name))

        def progress_callback(d):
            if d.get("status") == "downloading":
                with completed_lock:
                    job["current_percent"] = d.get("percent", 0.0)

        video_id = track.get("videoId") or track.get("id") or track.get("url")
        res = scraper.download_track(
            video_id_or_url=video_id,
            output_subfolder=subfolder,
            audio_format=audio_format,
            audio_quality=audio_quality,
            metadata=track,
            progress_callback=progress_callback
        )

        with completed_lock:
            if res.get("success"):
                job["completed"] += 1
                rel_path = os.path.relpath(res["filepath"], scraper.download_dir)
                job["files"].append({
                    "videoId": video_id,
                    "title": track_title,
                    "artist": artist_name,
                    "album": album_name,
                    "filename": res["filename"],
                    "relative_path": rel_path,
                    "ext": os.path.splitext(res["filename"])[1][1:].lower(),
                })
            else:
                job["errors"].append({"track": track_title, "error": res.get("error")})

    max_workers = min(6, len(tracks))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        list(executor.map(download_single, enumerate(tracks)))

    job["status"] = "completed"
    job["current_percent"] = 100.0

@app.route("/api/download/status/<job_id>", methods=["GET"])
def download_status(job_id):
    job = download_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)

@app.route("/api/library", methods=["GET"])
def get_library():
    music_files = []
    supported_exts = (".mp3", ".m4a", ".flac", ".wav", ".opus")

    for root, dirs, files in os.walk(scraper.download_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]  # skip hidden folders
        for f in files:
            if f.endswith(supported_exts):
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, scraper.download_dir)
                size_mb = round(os.path.getsize(full_path) / (1024 * 1024), 2)

                path_parts = rel_path.split(os.sep)
                artist = path_parts[0] if len(path_parts) > 1 else "Various Artists"
                album = path_parts[1] if len(path_parts) > 2 else (path_parts[0] if len(path_parts) == 2 else "Single")
                title = os.path.splitext(f)[0]

                music_files.append({
                    "filename": f,
                    "relative_path": rel_path,
                    "title": title,
                    "artist": artist,
                    "album": album,
                    "size_mb": size_mb,
                    "ext": os.path.splitext(f)[1][1:].upper()
                })

    music_files.sort(key=lambda x: x["relative_path"])
    return jsonify({"total": len(music_files), "files": music_files})

@app.route("/api/stream/<path:filename>")
def stream_file(filename):
    return send_from_directory(scraper.download_dir, filename)

@app.route("/api/artwork/<path:filename>")
def library_artwork(filename):
    full_path = library_path(filename)
    art = scraper.read_embedded_artwork(full_path) if full_path and os.path.isfile(full_path) else None
    if not art:
        return jsonify({"error": "No artwork"}), 404
    data, mime = art
    response = Response(data, mimetype=mime)
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response

@app.route("/api/download_file/<path:filename>")
def download_file(filename):
    full_path = library_path(filename)
    if full_path and os.path.isfile(full_path):
        return send_file(full_path, as_attachment=True)
    return jsonify({"error": "File not found"}), 404

@app.route("/api/delete_file", methods=["POST"])
def delete_file():
    data = request.get_json() or {}
    rel_path = data.get("relative_path")
    if not rel_path:
        return jsonify({"error": "File path required"}), 400

    full_path = library_path(rel_path)
    if full_path and os.path.isfile(full_path):
        try:
            os.remove(full_path)
            return jsonify({"success": True})
        except Exception as e:
            app.logger.error("Failed to delete %s: %s", rel_path, e)
            return jsonify({"error": "The file could not be deleted."}), 500
    return jsonify({"error": "File not found"}), 404

if __name__ == "__main__":
    # Listen on the LAN so the mobile app can connect. Never enable the Werkzeug
    # debugger there by default: it allows remote code execution.
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host=os.environ.get("OHMWAVE_HOST", "0.0.0.0"), port=int(os.environ.get("OHMWAVE_PORT", 5000)),
            debug=debug, threaded=True)
