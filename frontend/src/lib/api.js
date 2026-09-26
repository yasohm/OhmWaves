export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const USER_ID = 'local-listener';

export const apiUrl = (path) => `${API_URL}${path}`;
export const apiFetch = (path, options) => fetch(apiUrl(path), options);

/** Encode each segment of a library path so names with #, ? or spaces survive. */
export const encodePath = (relativePath) => relativePath.split(/[\\/]/).map(encodeURIComponent).join('/');

async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await apiFetch(path, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Can’t reach the OhmWave server. Check that it’s running and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error?.message || data.error || 'Something went wrong. Please try again.');
  }
  return data.data ?? data;
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  delete: (path, body, options) => request(path, { ...options, method: 'DELETE', body }),
};

const warmed = new Map();
/** Pre-resolve a track's stream (on hover, focus or when likely next) so pressing play is near-instant. */
export const warmTrack = (track) => {
  const id = track?.videoId;
  if (!id || track.relative_path || Date.now() - (warmed.get(id) || 0) < 30 * 60 * 1000) return;
  warmed.set(id, Date.now());
  sendQuietly(`/api/listen/${id}/warm`);
};

/** Fire-and-forget telemetry that must never break playback. */
export const sendQuietly = (path, body) => {
  apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    keepalive: true,
  }).catch(() => {});
};
