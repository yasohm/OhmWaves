"""
Where labelled training songs come from.

- AI:    songs on the YouTube channels of artists in the Soul Over AI directory (https://souloverai.com),
         a community-curated list of confirmed AI-music artists. Data © Soul Over AI, CC BY 4.0; we only read
         artist names and YouTube channel ids from it, unchanged.
- Human: songs from albums released 2005–2019, before AI song generators existed, across the same genres the
         AI artists publish in, so the model learns the generator's traces rather than a genre or an era.
"""
import random

import requests

SOUL_OVER_AI_URL = "https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json"
SOUL_OVER_AI_CREDIT = "AI artist data by Soul Over AI (https://souloverai.com), CC BY 4.0."

HUMAN_GENRES = [
    "lofi hip hop", "soul", "jazz", "blues", "country", "folk", "indie rock", "rock", "pop", "r&b", "hip hop",
    "electronic", "ambient", "piano", "gospel", "metal", "reggae", "latin pop", "chillout", "synthwave",
    "acoustic", "singer songwriter", "edm", "classical", "funk", "punk", "k-pop", "afrobeats", "bossa nova", "trap",
]
HUMAN_YEARS = range(2005, 2020)


def load_ai_artists(timeout=30):
    """Confirmed AI artists with a YouTube channel. Partly-AI ("AI-assisted") artists are left out to keep labels clean."""
    artists = requests.get(SOUL_OVER_AI_URL, timeout=timeout).json()
    return [{"name": a["name"], "channel": a["youtube"]} for a in artists
            if a.get("youtube") and not a.get("removed") and a.get("disclosure") != "partial"]


def ai_candidates(ytmusic, artists, per_artist=2, seed=7):
    """Yield (track, label) for songs from AI artists' channels, a couple per artist for variety."""
    rng = random.Random(seed)
    artists = list(artists)
    rng.shuffle(artists)
    for artist in artists:
        try:
            page = ytmusic.get_artist(artist["channel"])
        except Exception:
            continue  # not a YouTube Music artist channel
        songs = [s for s in (page.get("songs") or {}).get("results", []) if s.get("videoId")]
        for song in songs[:per_artist]:
            yield {"videoId": song["videoId"], "title": song.get("title", ""), "artist": artist["name"],
                   "group": artist["channel"], "label": 1, "source": "soul-over-ai"}


def human_candidates(ytmusic, exclude_channels, per_album=2, seed=11):
    """Yield songs from pre-2020 albums across many genres. Artists on the AI list are skipped."""
    rng = random.Random(seed)
    queries = [(genre, year) for genre in HUMAN_GENRES for year in HUMAN_YEARS]
    rng.shuffle(queries)
    seen_albums = set()
    for genre, year in queries:
        try:
            albums = ytmusic.search(f"{genre} {year}", filter="albums", limit=10)
        except Exception:
            continue
        rng.shuffle(albums)
        for album in albums[:2]:
            album_year = str(album.get("year") or "")
            if not album_year.isdigit() or not 2005 <= int(album_year) <= 2019 or album.get("browseId") in seen_albums:
                continue
            seen_albums.add(album.get("browseId"))
            try:
                details = ytmusic.get_album(album["browseId"])
            except Exception:
                continue
            artist = (details.get("artists") or [{}])[0]
            channel = artist.get("id") or artist.get("name") or album["browseId"]
            if channel in exclude_channels:
                continue
            tracks = [t for t in details.get("tracks", []) if t.get("videoId")]
            for track in rng.sample(tracks, min(per_album, len(tracks))):
                yield {"videoId": track["videoId"], "title": track.get("title", ""), "artist": artist.get("name", ""),
                       "group": channel, "label": 0, "source": f"album {album_year} · {genre}"}
