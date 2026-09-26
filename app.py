import os
import sys
import uuid
import threading
import time
import requests
from flask import Flask, Response, render_template, request, jsonify, send_file, send_from_directory, stream_with_context
from werkzeug.security import safe_join
from yt_music_scraper import YTMusicScraper
from recommendation_service import RecommendationService, VIDEO_ID_RE

app = Flask(__name__)

@app.after_request
def add_mobile_cors_headers(response):
    # Capacitor serves the UI from capacitor://localhost on native devices.
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Range"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    response.headers["Access-Control-Expose-Headers"] = "Content-Length, Content-Range, Accept-Ranges"
    return response

scraper = YTMusicScraper(download_dir="downloads")
recommendations = RecommendationService(catalog=scraper)


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

@app.route("/api/home/<user_id>", methods=["GET"])
def get_home(user_id):
    if not valid_user_id(user_id):
        return api_error("Invalid user id")
    return api_ok(recommendations.home(user_id))

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
    return api_ok({"tracks": tracks})

@app.route("/api/recommendations/<user_id>", methods=["GET"])
def get_recommendations(user_id):
    try:
        limit = request.args.get("limit", 20, type=int)
        return jsonify({"user_id": user_id, "recommendations": recommendations.recommend(user_id, limit)})
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400

STREAM_HEADERS = ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges")

def _open_upstream(video_id, force=False):
    info = scraper.resolve_stream(video_id, force=force)
    headers = dict(info["headers"])
    headers["Range"] = request.headers.get("Range", "bytes=0-")
    return info, requests.get(info["url"], headers=headers, stream=True, timeout=20)

@app.route("/api/listen/<video_id>", methods=["GET"])
def listen(video_id):
    """Stream a track instantly by proxying its audio (with Range support for seeking)."""
    if not VIDEO_ID_RE.match(video_id):
        return api_error("Invalid track id")
    try:
        info, upstream = _open_upstream(video_id)
        if upstream.status_code in (403, 410):
            upstream.close()
            info, upstream = _open_upstream(video_id, force=True)
    except Exception as exc:
        app.logger.warning("Stream resolution failed for %s: %s", video_id, exc)
        return api_error("This track is unavailable for streaming right now.", "STREAM_UNAVAILABLE", 502)
    if upstream.status_code >= 400:
        upstream.close()
        return api_error("This track is unavailable for streaming right now.", "STREAM_UNAVAILABLE", 502)

    response = Response(stream_with_context(upstream.iter_content(chunk_size=64 * 1024)),
                        status=upstream.status_code, direct_passthrough=True)
    for header in STREAM_HEADERS:
        if header in upstream.headers:
            response.headers[header] = upstream.headers[header]
    response.headers.setdefault("Content-Type", info["mime"])
    response.headers["Cache-Control"] = "no-store"
    response.call_on_close(upstream.close)
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

@app.route("/assets/<path:filename>")
def serve_assets(filename):
    assets_dir = os.path.join(os.path.dirname(__file__), "frontend", "dist", "assets")
    if os.path.exists(assets_dir):
        return send_from_directory(assets_dir, filename)
    return jsonify({"error": "Asset not found"}), 404

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

    return jsonify(res)

@app.route("/api/album/<browse_id>", methods=["GET"])
def get_album(browse_id):
    res = scraper.get_album_tracks(browse_id)
    return jsonify(res)

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
                    "title": track_title,
                    "artist": artist_name,
                    "album": album_name,
                    "filename": res["filename"],
                    "relative_path": rel_path
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

    for root, _, files in os.walk(scraper.download_dir):
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
