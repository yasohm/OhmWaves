"""Fetch a short clip of a YouTube track as 16 kHz mono samples, without downloading the whole song."""
import os
import subprocess
import tempfile

import numpy as np
import requests

from .features import SAMPLE_RATE

CLIP_BYTES = 2_000_000      # ~2 minutes of YouTube's 128 kbps AAC
CLIP_START = 15             # skip intros, which are often quiet
CLIP_SECONDS = 90
FFMPEG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bin", "ffmpeg")


def decode_clip(path, start=CLIP_START, seconds=CLIP_SECONDS):
    """Decode part of an audio file to mono float32 at 16 kHz. Short songs are read from the beginning."""
    ffmpeg = FFMPEG if os.path.exists(FFMPEG) else "ffmpeg"

    def run(offset):
        result = subprocess.run(
            [ffmpeg, "-v", "error", "-ss", str(offset), "-t", str(seconds), "-i", path,
             "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
            capture_output=True, timeout=60)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg could not decode the audio: {result.stderr.decode(errors='replace')[-200:]}")
        return np.frombuffer(result.stdout, dtype=np.float32)

    samples = run(start)
    return samples if len(samples) >= 20 * SAMPLE_RATE or start == 0 else run(0)


def fetch_clip(scraper, video_id, attempts=2):
    """Download the first ~2 MB of a track's audio stream and decode a clip of it."""
    last_error = None
    for attempt in range(attempts):
        try:
            info = scraper.resolve_stream(video_id, force=attempt > 0)
            headers = dict(info["headers"])
            headers["Range"] = f"bytes=0-{CLIP_BYTES - 1}"
            response = requests.get(info["url"], headers=headers, timeout=30)
            if response.status_code not in (200, 206) or len(response.content) < 100_000:
                raise RuntimeError(f"YouTube returned HTTP {response.status_code} with {len(response.content)} bytes")
            with tempfile.NamedTemporaryFile(suffix=".m4a") as handle:
                handle.write(response.content)
                handle.flush()
                return decode_clip(handle.name)
        except Exception as exc:  # expired stream URLs and empty replies are retried once with a fresh URL
            last_error = exc
    raise RuntimeError(f"Couldn't fetch audio for {video_id}: {last_error}")
