import { Capacitor } from '@capacitor/core';

export const USER_ID = 'local-listener';
const SERVER_KEY = 'ohmwave:server';

/** The native app talks to the OhmWaves server on your computer; the web app uses its own origin. */
export const isNativeApp = Capacitor.isNativePlatform();
export const DEFAULT_SERVER = import.meta.env.VITE_DEFAULT_SERVER || '';

export function normalizeServer(input) {
  const text = (input || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `http://${text}`;
}

const readServer = () => {
  try { return localStorage.getItem(SERVER_KEY) || ''; } catch { return ''; }
};
let apiBase = normalizeServer(import.meta.env.VITE_API_URL || (isNativeApp ? readServer() : ''));

export const getServer = () => apiBase;
export const needsServer = () => isNativeApp && !apiBase;
export function setServer(url) {
  apiBase = normalizeServer(url);
  try { if (apiBase) localStorage.setItem(SERVER_KEY, apiBase); else localStorage.removeItem(SERVER_KEY); } catch { /* kept for this session only */ }
}

export const apiUrl = (path) => `${apiBase}${path}`;
export const apiFetch = (path, options) => fetch(apiUrl(path), options);

/** Encode each segment of a library path so names with #, ? or spaces survive. */
export const encodePath = (relativePath) => relativePath.split(/[\\/]/).map(encodeURIComponent).join('/');

const networkErrorListeners = new Set();
/** Hear about requests that couldn't reach the server at all (offline mode re-checks the connection). */
export function onNetworkError(listener) {
  networkErrorListeners.add(listener);
  return () => networkErrorListeners.delete(listener);
}

/** True when the server answers within `timeoutMs`. Any HTTP reply counts: it means the server is up. */
export async function pingServer(timeoutMs = 4000) {
  if (!apiBase && isNativeApp) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await apiFetch('/api/health', { signal: controller.signal, cache: 'no-store' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

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
    networkErrorListeners.forEach((listener) => listener());
    throw new Error('Can’t reach the OhmWaves server. Check that it’s running and try again.');
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
