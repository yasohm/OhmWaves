import { registerPlugin } from '@capacitor/core';

const NativePlayer = registerPlugin('NativePlayer');

/**
 * The phone app plays through Android's media service (see PlaybackService.java) so music keeps going in the
 * background and shows in the notification shade. This class mirrors the slice of HTMLAudioElement that the
 * player uses, so PlayerContext drives both engines the same way.
 *
 * Set `nowPlaying` ({ title, artist, album, artwork, track }) before `src`: it becomes the notification's metadata.
 */
export default class NativeAudio extends EventTarget {
  constructor() {
    super();
    this.preload = 'auto';
    this.nowPlaying = null;
    this._src = '';
    this._paused = true;
    this._time = 0;
    this._duration = NaN;
    this._volume = 1;
    this._stopped = false; // "Stop" in the notification unloads the track; play() reloads it where it was.
    NativePlayer.addListener('media', (event) => this._onMedia(event));
    NativePlayer.addListener('remote', ({ action }) => {
      if (action === 'stop') { this._stopped = true; this._setPaused(true); }
      this.dispatchEvent(new Event(`remote${action}`));
    });
  }

  get src() { return this._src; }
  set src(url) { this._load(url, true).catch(() => this._emit('error')); }
  get currentSrc() { return this._src; }
  getAttribute(name) { return name === 'src' ? this._src || null : null; }
  removeAttribute(name) {
    if (name !== 'src' || !this._src) return;
    this._src = '';
    this._stopped = false;
    NativePlayer.stop().catch(() => {});
  }

  get paused() { return this._paused; }
  get duration() { return this._duration; }
  get currentTime() { return this._time; }
  set currentTime(seconds) {
    this._time = seconds;
    this._emit('seeking');
    if (this._stopped) return;
    NativePlayer.seek({ position: seconds }).catch(() => {});
    this._emit('timeupdate');
  }

  get volume() { return this._volume; }
  set volume(value) {
    this._volume = value;
    NativePlayer.setVolume({ volume: value }).catch(() => {});
  }

  play() {
    if (!this._src) return Promise.resolve();
    this._setPaused(false);
    if (this._stopped) return this._load(this._src, true, this._time);
    return NativePlayer.play();
  }

  pause() {
    this._setPaused(true);
    NativePlayer.pause().catch(() => {});
  }

  /** Reattach to a track that kept playing while the app was closed. Resolves to its saved track, or null. */
  async restore() {
    const state = await NativePlayer.getState().catch(() => ({}));
    if (!state.url || !state.track) return null;
    let track;
    try { track = JSON.parse(state.track); } catch { return null; }
    this._src = state.url;
    this._time = state.position || 0;
    this._duration = state.duration || NaN;
    this._setPaused(!state.playing);
    this._emit('durationchange');
    if (state.playing) this._emit('playing');
    if (state.openPlayer) setTimeout(() => this._emit('remoteopen')); // launched from the notification
    return track;
  }

  _load(url, autoplay, position = 0) {
    this._src = url;
    this._stopped = false;
    this._time = position;
    this._duration = NaN;
    if (autoplay) this._setPaused(false);
    const meta = this.nowPlaying || {};
    return NativePlayer.load({
      url, autoplay, position,
      title: meta.title || '', artist: meta.artist || '', album: meta.album || '',
      artwork: meta.artwork || '', track: meta.track ? JSON.stringify(meta.track) : '',
    });
  }

  _onMedia({ type, position, duration, message }) {
    // Once stopped, the unloaded player reports position 0; keep where the listener actually was.
    if (this._stopped) return;
    if (Number.isFinite(position)) this._time = position;
    if (duration) this._duration = duration;
    if (type === 'play' || type === 'pause') { this._setPaused(type === 'pause'); return; }
    if (type === 'ended') this._setPaused(true); // like <audio>: 'pause' fires before 'ended'
    if (type === 'error') this.lastError = message;
    this._emit(type);
  }

  _setPaused(paused) {
    if (this._paused === paused) return;
    this._paused = paused;
    this._emit(paused ? 'pause' : 'play');
  }

  _emit(type) { this.dispatchEvent(new Event(type)); }
}
