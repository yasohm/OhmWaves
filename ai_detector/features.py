"""Fakeprint features: the fine structure of a song's average spectrum between 1 and 8 kHz."""
import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import welch

SAMPLE_RATE = 16000
N_FFT = 8192            # ~2 Hz resolution: generator peaks are narrow
LOW_HZ, HIGH_HZ = 1000, 8000
ENVELOPE_BINS = 41      # ~80 Hz: wider than an artifact peak, narrower than musical structure
MIN_SECONDS = 10
FEATURE_SIZE = 3585     # bins between LOW_HZ and HIGH_HZ at this resolution


def fakeprint(samples):
    """
    Average power spectrum of mono 16 kHz audio, minus its smooth lower envelope, so what remains is the
    narrow peaks (the generator's fingerprint) rather than the song's overall tone. Scaled to 0–1.
    """
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim != 1:
        raise ValueError("Expected mono audio.")
    if len(samples) < MIN_SECONDS * SAMPLE_RATE:
        raise ValueError(f"Need at least {MIN_SECONDS} seconds of audio.")
    if not np.isfinite(samples).all() or np.abs(samples).max() < 1e-4:
        raise ValueError("The audio is silent or corrupted.")

    freqs, power = welch(samples, fs=SAMPLE_RATE, window="hann", nperseg=N_FFT, noverlap=N_FFT // 2, scaling="spectrum")
    band = (freqs >= LOW_HZ) & (freqs <= HIGH_HZ)
    level_db = 10 * np.log10(power[band] + 1e-12)
    envelope = uniform_filter1d(minimum_filter1d(level_db, ENVELOPE_BINS, mode="nearest"), ENVELOPE_BINS, mode="nearest")
    residual = np.clip(level_db - envelope, 0, None)
    peak = residual.max()
    return (residual / peak if peak > 0 else residual).astype(np.float32)
