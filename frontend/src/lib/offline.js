import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { upscale } from './tracks';

/**
 * Phone downloads, Spotify-style: tracks live in the app's private storage, which other apps, the gallery and
 * file managers can't open, and are played only by OhmWaves. An index file keeps their metadata for offline use.
 */
const DIR = Directory.Data;
const ROOT = 'offline';
const ART = `${ROOT}/art`;
const INDEX = `${ROOT}/index.json`;

/**
 * On Android, `downloadFile` ignores `recursive` and fails when the target folder is missing, so create the
 * folders up front. Without this, every cover download failed and songs were saved without artwork.
 */
let folders = null;
function ensureFolders() {
  folders ??= Filesystem.mkdir({ path: ART, directory: DIR, recursive: true })
    .catch(() => {}); // already exists
  return folders;
}

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

/** Download a track's audio straight into app storage, with its cover art for offline artwork. */
export async function saveTrack(track, fileUrl, ext, onProgress) {
  await ensureFolders();
  const id = safeName(track.videoId);
  const audioPath = `${ROOT}/${id}.${/^[a-z0-9]{2,5}$/.test(ext) ? ext : 'm4a'}`;
  const listener = onProgress
    ? await Filesystem.addListener('progress', (p) => { if (p.url === fileUrl && p.contentLength > 0) onProgress(p.bytes / p.contentLength); })
    : null;
  try {
    await Filesystem.downloadFile({ url: fileUrl, path: audioPath, directory: DIR, recursive: true, progress: !!onProgress });
  } catch (error) {
    // A transfer cut short (lost Wi-Fi, server stopped) leaves a partial file that would never play.
    await Filesystem.deleteFile({ path: audioPath, directory: DIR }).catch(() => {});
    throw error;
  } finally {
    listener?.remove();
  }
  const [{ uri }, { size }] = await Promise.all([
    Filesystem.getUri({ path: audioPath, directory: DIR }),
    Filesystem.stat({ path: audioPath, directory: DIR }),
  ]);

  const entry = {
    videoId: track.videoId, title: track.title, artist: track.artist, album: track.album || '', duration: track.duration || '',
    // Album details keep downloaded albums together and in order offline.
    albumId: track.albumId || null, albumArtist: track.albumArtist || null, trackNumber: track.trackNumber || null,
    remoteCover: track.remoteCover || track.cover || null, audioPath, uri, artPath: null, artUri: null, size, addedAt: Date.now(),
  };
  return { ...entry, ...(await saveArtwork(entry)) };
}

/**
 * Save a downloaded song's cover next to it so it shows offline and in the notification.
 * Resolves to `{ artPath, artUri }`, or nulls when there's no cover or it couldn't be fetched (the song still plays).
 */
export async function saveArtwork(entry) {
  if (!entry.remoteCover?.startsWith('http')) return { artPath: null, artUri: null };
  await ensureFolders();
  const artPath = `${ART}/${safeName(entry.videoId)}.jpg`;
  try {
    await Filesystem.downloadFile({ url: upscale(entry.remoteCover), path: artPath, directory: DIR, recursive: true });
    return { artPath, artUri: (await Filesystem.getUri({ path: artPath, directory: DIR })).uri };
  } catch {
    await Filesystem.deleteFile({ path: artPath, directory: DIR }).catch(() => {});
    return { artPath: null, artUri: null };
  }
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
    remoteCover: entry.remoteCover,
    artUri: entry.artUri,
    albumId: entry.albumId || null,
    albumArtist: entry.albumArtist || null,
    trackNumber: entry.trackNumber || null,
    localUri: entry.uri,
    format: entry.audioPath.split('.').pop().toUpperCase(),
    sizeMb: Math.round((entry.size / (1024 * 1024)) * 100) / 100,
  };
}
