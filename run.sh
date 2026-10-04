#!/usr/bin/env bash
# Run OhmWaves with one command.
#
#   ./run.sh           Build the frontend if needed, then serve everything from Flask (http://localhost:5000)
#   ./run.sh --dev     Run Flask + the Vite dev server with hot reload (http://localhost:5173)
#   ./run.sh --build   Force a fresh frontend build before starting
#
# Environment: OHMWAVE_PORT (default 5000), OHMWAVE_HOST (default 0.0.0.0), FLASK_DEBUG=1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MODE="prod"
FORCE_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --dev) MODE="dev" ;;
    --build) FORCE_BUILD=1 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 1 ;;
  esac
done

info() { printf '\033[38;5;208m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# --- Python environment -------------------------------------------------------
if [[ -d .venv ]]; then VENV=.venv
elif [[ -d venv ]]; then VENV=venv
else
  command -v python3 >/dev/null || die "python3 is not installed."
  info "Creating Python virtual environment in .venv"
  python3 -m venv .venv
  VENV=.venv
fi
PY="$ROOT/$VENV/bin/python"

if ! "$PY" -c "import flask, requests, ytmusicapi, yt_dlp, mutagen" 2>/dev/null; then
  info "Installing backend dependencies"
  "$PY" -m pip install --quiet flask requests ytmusicapi yt-dlp mutagen
fi

# --- Frontend -----------------------------------------------------------------
command -v npm >/dev/null || die "npm is not installed (Node.js 20.19+ required)."

if [[ ! -d frontend/node_modules ]]; then
  info "Installing frontend dependencies"
  npm --prefix frontend install
fi

if [[ "$MODE" == "prod" ]]; then
  # Rebuild when forced, missing, or any frontend source is newer than the build.
  if [[ $FORCE_BUILD -eq 1 || ! -f frontend/dist/index.html ]] ||
     [[ -n "$(find frontend/src frontend/index.html frontend/vite.config.* frontend/package.json \
              -newer frontend/dist/index.html -print -quit 2>/dev/null)" ]]; then
    info "Building frontend"
    npm --prefix frontend run build
  fi

  info "Starting OhmWaves on http://localhost:${OHMWAVE_PORT:-5000}"
  exec "$PY" app.py
fi

# --- Dev mode: Flask + Vite, stopped together on Ctrl+C ------------------------
pids=()
cleanup() {
  trap - INT TERM EXIT
  info "Shutting down"
  kill "${pids[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

info "Starting Flask API on http://localhost:${OHMWAVE_PORT:-5000}"
"$PY" app.py & pids+=($!)

info "Starting Vite dev server on http://localhost:5173"
npm --prefix frontend run dev & pids+=($!)

# Exit as soon as either process stops, taking the other down with it.
wait -n
