import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { upscale } from './tracks';

/**
 * Phone downloads, Spotify-style: tracks live in the app's private storage, which other apps, the gallery and
 * file managers can't open, and are played only by OhmWaves. An index file keeps their metadata for offline use.
 */
const DIR = Directory.Data;
const ROOT = 'offline';
const INDEX = `${ROOT}/index.json`;

const safeName = (text) => String(text).replace(/[^\w-]/g, '');

export async function readIndex() {
  try {
    const { data } = await Filesystem.readFile({ path: INDEX, directory: DIR, encoding: Encoding.UTF8 });
    const entries = JSON.parse(data);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return []; // nothing downloaded yet
  }
}

let writing = Promise.resolve();
/** Writes are chained so a slow write can never land after a newer one. */
export function writeIndex(entries) {
  writing = writing
    .then(() => Filesystem.writeFile({ path: INDEX, directory: DIR, encoding: Encoding.UTF8, data: JSON.stringify(entries), recursive: true }))
    .catch(() => {});
  return writing;
}

/** Copy a track the server prepared into app storage, with its cover art for offline artwork. */
export async function saveTrack(track, fileUrl, ext, onProgress) {
  const id = safeName(track.videoId);
  const audioPath = `${ROOT}/${id}.${/^[a-z0-9]{2,5}$/.test(ext) ? ext : 'mp3'}`;
  const listener = onProgress
    ? await Filesystem.addListener('progress', (p) => { if (p.url === fileUrl && p.contentLength > 0) onProgress(p.bytes / p.contentLength); })
    : null;
  try {
    await Filesystem.downloadFile({ url: fileUrl, path: audioPath, directory: DIR, recursive: true, progress: !!onProgress });
  } finally {
    listener?.remove();
  }
  const [{ uri }, { size }] = await Promise.all([
    Filesystem.getUri({ path: audioPath, directory: DIR }),
    Filesystem.stat({ path: audioPath, directory: DIR }),
  ]);

  let artPath = null;
  let artUri = null;
  if (track.cover?.startsWith('http')) {
    try {
      artPath = `${ROOT}/art/${id}.jpg`;
      await Filesystem.downloadFile({ url: upscale(track.cover), path: artPath, directory: DIR, recursive: true });
      artUri = (await Filesystem.getUri({ path: artPath, directory: DIR })).uri;
    } catch {
      artPath = null; // the track still plays; it just shows the placeholder art offline
    }
  }

  return {
    videoId: track.videoId, title: track.title, artist: track.artist, album: track.album || '', duration: track.duration || '',
    remoteCover: track.cover || null, audioPath, uri, artPath, artUri, size, addedAt: Date.now(),
  };
}

export async function removeTrack(entry) {
  await Promise.all([entry.audioPath, entry.artPath].filter(Boolean)
    .map((path) => Filesystem.deleteFile({ path, directory: DIR }).catch(() => {})));
}

/** Player/list shape for a downloaded track. `localUri` plays from disk; `artUri` feeds the notification. */
export function entryToTrack(entry) {
  return {
    id: entry.videoId,
    videoId: entry.videoId,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    duration: entry.duration,
    cover: entry.artUri ? Capacitor.convertFileSrc(entry.artUri) : entry.remoteCover,
    artUri: entry.artUri,
    localUri: entry.uri,
    format: entry.audioPath.split('.').pop().toUpperCase(),
    sizeMb: Math.round((entry.size / (1024 * 1024)) * 100) / 100,
  };
}
