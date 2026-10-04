/** Grouping downloaded songs into albums and artists, shared by the library and the offline home. */

/** "Artist A, Artist B" → "Artist A": features shouldn't split an artist into several entries. */
export const primaryArtist = (name) => (name || '').split(',')[0].trim();

/** Songs from the same album belong together even when individual tracks credit guest artists. */
export const albumKey = (track) => track.albumId || `${(track.albumArtist || primaryArtist(track.artist)).toLowerCase()}::${track.album.toLowerCase()}`;

export const songCount = (n) => `${n} ${n === 1 ? 'song' : 'songs'}`;

/** Downloaded albums, each with its songs in album order. */
export function groupAlbums(tracks) {
  const albums = new Map();
  tracks.forEach((t) => {
    if (!t.album) return;
    const key = albumKey(t);
    if (!albums.has(key)) albums.set(key, { key, title: t.album, artist: t.albumArtist || primaryArtist(t.artist), cover: t.cover, tracks: [] });
    albums.get(key).tracks.push(t);
  });
  return [...albums.values()].map((a) => ({ ...a, tracks: sortAlbumTracks(a.tracks) }));
}

/** Album order when we know it (albums downloaded from their page), otherwise the order they were saved. */
export const sortAlbumTracks = (tracks) => [...tracks].sort((a, b) => (a.trackNumber || Infinity) - (b.trackNumber || Infinity));

/** Artists of the given songs, most songs first. */
export function groupArtists(tracks) {
  const artists = new Map();
  tracks.forEach((t) => {
    const name = primaryArtist(t.artist);
    if (!name || name === 'Various Artists' || name === 'Unknown artist') return;
    const key = name.toLowerCase();
    const entry = artists.get(key) || { key, name, cover: null, count: 0 };
    entry.count += 1;
    entry.cover = entry.cover || t.cover;
    artists.set(key, entry);
  });
  return [...artists.values()].sort((a, b) => b.count - a.count);
}

/** First cover among the songs, for playlists that don't have their own artwork. */
export const firstCover = (tracks) => tracks.find((t) => t.cover)?.cover || null;
