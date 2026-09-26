import { apiUrl, encodePath } from './api';

const pickCover = (item) => item.cover || item.thumbnails?.at?.(-1)?.url || item.thumbnail?.at?.(-1)?.url || null;

/** Normalise any track-shaped payload from the API into one client shape. */
export function normalizeTrack(item, fallback = {}) {
  const videoId = item.videoId || (/^[\w-]{11}$/.test(item.id || '') ? item.id : null);
  return {
    id: videoId || item.relative_path || item.id || `${item.title}-${item.artist}`,
    videoId,
    title: item.title || item.name || 'Untitled',
    artist: (typeof item.artist === 'string' ? item.artist : item.artists?.[0]?.name) || fallback.artist || 'Unknown artist',
    album: (typeof item.album === 'string' ? item.album : item.album?.name) || fallback.album || '',
    duration: item.duration || '',
    cover: pickCover(item) || fallback.cover || null,
    reason: item.reason || null,
    relative_path: item.relative_path || null,
  };
}

/** Library files come from disk: stream locally and read their embedded artwork. */
export function libraryFileToTrack(file) {
  return {
    id: file.relative_path,
    videoId: null,
    title: file.title,
    artist: file.artist,
    album: file.album === 'Single' ? '' : file.album,
    duration: '',
    cover: apiUrl(`/api/artwork/${encodePath(file.relative_path)}`),
    relative_path: file.relative_path,
    format: file.ext,
    sizeMb: file.size_mb,
  };
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function durationToSeconds(duration) {
  if (!duration || typeof duration !== 'string') return 0;
  return duration.split(':').reduce((total, part) => total * 60 + (Number(part) || 0), 0);
}

export function totalDurationLabel(tracks) {
  const seconds = tracks.reduce((sum, t) => sum + durationToSeconds(t.duration), 0);
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours} hr ${minutes} min` : `${minutes} min`;
}

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Deterministic hue for placeholders so each artist keeps "their" colour. */
export function hueFor(text = '') {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
