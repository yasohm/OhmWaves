<p align="center">
  <img src="img/ohmwaves-logo-on-dark.png" alt="OhmWave Logo" width="400" />
</p>
<p align="center">
  Local music search, downloads, playback, and recommendations powered by YouTube Music.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.9%2B-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.9 or later" />
  <img src="https://img.shields.io/badge/Flask-API-000000?style=flat-square&logo=flask&logoColor=white" alt="Flask API" />
  <img src="https://img.shields.io/badge/React-Vite-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React and Vite" />
  <img src="https://img.shields.io/badge/Capacitor-Mobile-119EFF?style=flat-square&logo=capacitor&logoColor=white" alt="Capacitor mobile client" />
  <img src="https://img.shields.io/badge/yt--dlp-Audio-FF0000?style=flat-square" alt="yt-dlp" />
</p>

OhmWave is a local-first music application. Search YouTube Music by track, artist, album, or genre; download selected results to a managed local library; and stream or manage the resulting files from the web interface. The repository also contains an interactive CLI and a Capacitor client for Android and iOS.

> **Responsible use:** You are responsible for complying with YouTube's terms, copyright law, and all applicable local regulations. This project is intended for local, personal use.

## Highlights

- Dark, Spotify/Deezer-style interface for desktop and mobile: personal Home shelves, full-screen player tinted by the artwork, queue, shuffle/repeat, lock-screen and media-key controls.
- Instant streaming: tracks play straight away without downloading, and likely next tracks are prefetched.
- Search tracks, artists, albums, and genres through YouTube Music, with a `yt-dlp` search fallback.
- Download one or multiple tracks concurrently as MP3, M4A, FLAC, WAV, or Opus.
- Select 320, 256, 192, or 128 kbps conversion quality where the source and codec support it.
- Embed title, artist, album, year, and cover art in MP3, M4A, and FLAC downloads.
- Store downloads in artist and album folders; browse, stream, save, and delete them from the library.
- Track asynchronous download jobs and progress in the UI.
- Use the same backend from a React web client, Capacitor mobile app, or terminal.
- Hybrid personal recommendations that learn from plays, skips and likes, explain every pick, and power endless autoplay.

## Architecture

```text
React + Vite web client ─┐
Capacitor Android/iOS ───┼──> Flask API ──> YouTube Music / yt-dlp / FFmpeg
Interactive CLI ─────────┘       │
                                  ├── downloads/        local audio library
                                  └── ohmwave.db        interactions and likes
```

## Project layout

```text
.
├── app.py                       # Flask server and JSON API
├── cli.py                       # Interactive and scripted command-line client
├── yt_music_scraper.py          # Search, download, conversion, and tagging
├── recommendation_service.py    # Hybrid recommender: taste profile, catalog candidates, ranking
├── tests/                       # Offline recommender tests (python -m unittest)
├── requirements-recommendations.txt
├── frontend/                    # React, Vite, and Capacitor application
├── templates/                   # HTML fallback when the React app is not built
├── static/                      # Assets used by the fallback interface
├── bin/                         # Bundled ffmpeg and ffprobe binaries
├── models/                      # Persisted recommendation model (if trained)
└── downloads/                   # Generated local music library (gitignored)
```

## Prerequisites

- Python 3.9 or later
- Node.js 20.19 or later (or 22.12 or later) and npm, matching Vite 8's supported engines
- FFmpeg and FFprobe. Bundled binaries are used when available; otherwise install both on your `PATH`.
- Network access to YouTube and YouTube Music

For native builds, also install the platform tooling required by Capacitor: Android Studio for Android and Xcode/CocoaPods on macOS for iOS.

## Quick start: web application

From the repository root, create an isolated Python environment and install the backend dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install flask requests ytmusicapi yt-dlp mutagen
```

Install and build the frontend:

```bash
cd frontend
npm install
npm run build
cd ..
```

Start the API and web server:

```bash
python app.py
```

Open <http://localhost:5000>. Flask serves `frontend/dist/index.html` when it exists; before a frontend build, it serves the fallback template in `templates/index.html`.

### Frontend development

Run Flask and Vite in separate terminals. Vite runs on <http://localhost:5173> and proxies `/api` requests to Flask at `http://127.0.0.1:5000`.

```bash
# Terminal 1, from the repository root
source .venv/bin/activate
python app.py

# Terminal 2
cd frontend
npm run dev
```

Useful frontend commands:

```bash
npm run build        # Create frontend/dist for Flask to serve
npm run lint         # Run Oxlint
npm run preview      # Preview a production build
```

## Mobile client

The Capacitor project is located in `frontend/`. Build the web bundle and synchronize it into the native projects:

```bash
cd frontend
npm install
npm run mobile:sync
```

Then open a native project:

```bash
npm run android
# or, on macOS
npm run ios
```

The browser client defaults to same-origin API requests. For a native device, set `VITE_API_URL` to the reachable address of the machine running Flask before building, for example:

```bash
VITE_API_URL=http://192.168.1.10:5000 npm run mobile:sync
```

The Flask server enables CORS for the Capacitor client. Ensure the device and server can reach one another; do not use `127.0.0.1` as the API host on a physical device.

## Command-line client

Running the CLI without a search option opens its interactive menu:

```bash
python cli.py
```

You can also issue a search directly and choose tracks interactively:

```bash
python cli.py --artist "Rihanna"
```

Or download every result without a selection prompt:

```bash
python cli.py --album "Album Name" --download-all --format flac
```

| Option | Description |
| --- | --- |
| `-a`, `--artist` | Search by artist name |
| `-l`, `--album` | Search by album name |
| `-g`, `--genre` | Search by genre |
| `-q`, `--query` | General track query |
| `-f`, `--format` | `mp3`, `m4a`, `flac`, `wav`, or `opus` (default: `mp3`) |
| `-k`, `--quality` | `320`, `256`, `192`, or `128` (default: `320`) |
| `--limit` | Maximum search results (default: `10`) |
| `--download-all` | Download every returned track |
| `-o`, `--output` | Download directory (default: `downloads`) |
| `-i`, `--interactive` | Explicitly open the interactive menu |

## API reference

The Flask API is local and currently has no authentication. Request and response validation should be added before exposing it beyond a trusted network.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/search` | Search by `query` and `type` (`track`, `artist`, `album`, or `genre`) |
| `GET` | `/api/album/<browse_id>` | Return album details and tracks |
| `POST` | `/api/download` | Start a background download job for `tracks`, `format`, and `quality` |
| `GET` | `/api/download/status/<job_id>` | Get job state, progress, files, and errors |
| `GET` | `/api/library` | List files in the local download library |
| `GET` | `/api/stream/<path:filename>` | Stream a library file |
| `GET` | `/api/download_file/<path:filename>` | Download a library file as an attachment |
| `POST` | `/api/delete_file` | Delete a library file using `relative_path` |
| `POST` | `/api/events` | Record a listening event |
| `GET` | `/api/listen/<video_id>` | Stream a track instantly (proxied, supports `Range` for seeking) |
| `POST` | `/api/listen/<video_id>/warm` | Prefetch a track's stream in the background |
| `GET` | `/api/artwork/<path:filename>` | Cover art embedded in a library file |
| `POST` | `/api/likes` | Create or refresh a user's track like |
| `DELETE` | `/api/likes` | Remove a like (`user_id`, `track_id`) |
| `GET` | `/api/likes/<user_id>` | List a user's liked tracks |
| `GET` | `/api/home/<user_id>` | Personal Home shelves (recently played, Made for you, On repeat, trending) |
| `POST` | `/api/recommendations/<user_id>/next` | Autoplay: tracks to follow `seed`, excluding `exclude` ids |
| `POST` | `/api/recommendations/retrain` | Train the optional multi-listener ALS model |
| `GET` | `/api/recommendations/<user_id>` | Return recommendations; accepts `?limit=1..50` |

Example search request:

```bash
curl -X POST http://localhost:5000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"Daft Punk","type":"artist"}'
```

Example download request:

```bash
curl -X POST http://localhost:5000/api/download \
  -H 'Content-Type: application/json' \
  -d '{"tracks":[{"videoId":"VIDEO_ID","title":"Track","artist":"Artist"}],"format":"mp3","quality":"320"}'
```

## Recommendations

Listening events and likes are stored in SQLite. `recommendation_service.py` is a hybrid engine designed for a local, usually single-listener app:

1. **Taste profile.** Each play becomes an implicit score: a full listen counts positively, a skip within 30 s counts negatively, and a like counts the most. Scores decay over time (a 30-day half-life for plays, 180 days for likes) and roll up into artist affinities.
2. **Candidates.** Seeds are sampled from your strongest tracks (so mixes refresh every few hours) and expanded with YouTube Music radio and your top artists' popular songs. Songs suggested by several seeds rank higher. Catalog lookups are cached in SQLite for 12 hours.
3. **Ranking.** Candidates are boosted by artist affinity. Songs you've already heard, or skipped twice recently, are removed. A diversity pass caps each artist at two songs per mix.
4. **Explanations.** Every pick carries a reason, such as "Because you liked Toxicity" or "More from Linkin Park".

With no history yet, Home shows global chart tracks. When the queue runs low, autoplay uses the same ranking seeded by the current song. The web client reports plays and skips automatically.

With several listeners, implicit ALS can add collaborative candidates. Install the optional dependencies and call the retrain endpoint:

```bash
pip install -r requirements-recommendations.txt
curl -X POST http://localhost:5000/api/recommendations/retrain
```

The service reads these optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OHMWAVE_DB` | `ohmwave.db` | SQLite database path for events and likes |
| `OHMWAVE_MODEL` | `models/als_latest.pkl` | Location of the serialized ALS model |
| `OHMWAVE_HOST` / `OHMWAVE_PORT` | `0.0.0.0` / `5000` | Address the API listens on |
| `FLASK_DEBUG` | `0` | Set to `1` to enable the Werkzeug debugger (never on a shared network) |
| `VITE_API_URL` | empty (same origin) | Base URL embedded in the Vite client for API requests |

`ohmwave.db`, generated downloads, frontend build output, and local environment files are ignored by Git.

## Local-use and security notes

- The development server listens on `0.0.0.0:5000` so the mobile app can connect. Debug mode is off by default because the Werkzeug debugger allows remote code execution; enable it with `FLASK_DEBUG=1` only on a trusted machine.
- Library file endpoints reject paths that escape the `downloads/` folder.
- The API uses permissive CORS to support the mobile client and has no authentication or authorization.
- Download jobs are held in application memory, so they do not survive a server restart.
- Do not expose this server directly to the public internet without adding authentication, restrictive CORS, production server configuration, and a review of file-serving endpoints.

## License

No license has been declared for this project.
