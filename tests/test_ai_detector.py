"""AI-detector tests on synthetic audio (no network, no training data)."""
import os
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_detector.features import FEATURE_SIZE, SAMPLE_RATE, fakeprint  # noqa: E402
from ai_detector.model import AIMusicModel  # noqa: E402
from ai_detector.train import threshold_for  # noqa: E402

rng = np.random.default_rng(0)


def noise(seconds=20):
    return (rng.standard_normal(seconds * SAMPLE_RATE) * 0.1).astype(np.float32)


def with_artifacts(samples, spacing_hz=500):
    """Add faint, evenly spaced tones: what an upsampling generator leaves behind."""
    t = np.arange(len(samples)) / SAMPLE_RATE
    tones = sum(0.01 * np.sin(2 * np.pi * f * t) for f in range(1000, 8000, spacing_hz))
    return (samples + tones).astype(np.float32)


class FakeprintTest(unittest.TestCase):
    def test_shape_and_range(self):
        vector = fakeprint(noise())
        self.assertEqual(vector.shape, (FEATURE_SIZE,))
        self.assertGreaterEqual(vector.min(), 0)
        self.assertLessEqual(vector.max(), 1)

    def test_artifact_peaks_stand_out(self):
        clean, marked = fakeprint(noise()), fakeprint(with_artifacts(noise()))
        bin_of = lambda hz: int(round((hz - 1000) / (SAMPLE_RATE / 8192)))  # noqa: E731
        peaks = [bin_of(f) for f in range(1500, 7500, 500)]
        self.assertGreater(marked[peaks].mean(), 0.5)
        self.assertLess(clean[peaks].mean(), 0.5)

    def test_rejects_unusable_audio(self):
        for bad in (noise(5), np.zeros(20 * SAMPLE_RATE, dtype=np.float32), np.stack([noise(), noise()])):
            with self.assertRaises(ValueError):
                fakeprint(bad)


class ModelTest(unittest.TestCase):
    def test_save_load_round_trip(self):
        coef = np.zeros(FEATURE_SIZE)
        coef[:10] = 1.0
        model = AIMusicModel(np.zeros(FEATURE_SIZE), np.ones(FEATURE_SIZE), coef, -5.0, 0.7, {"version": "test"})
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "m.npz")
            model.save(path)
            loaded = AIMusicModel.load(path)
        loud, quiet = np.zeros(FEATURE_SIZE), np.zeros(FEATURE_SIZE)
        loud[:10] = 1.0
        self.assertEqual(loaded.version, "test")
        self.assertAlmostEqual(loaded.probability(loud), 1 / (1 + np.exp(-5)), places=6)
        self.assertTrue(loaded.is_ai(loaded.probability(loud)))
        self.assertFalse(loaded.is_ai(loaded.probability(quiet)))

    def test_threshold_respects_false_positive_budget(self):
        y = np.array([0] * 100 + [1] * 100)
        scores = np.concatenate([np.linspace(0, 0.6, 100), np.linspace(0.4, 1, 100)])
        threshold = threshold_for(y, scores, 0.02)
        self.assertLessEqual(((scores >= threshold) & (y == 0)).sum(), 2)


if __name__ == "__main__":
    unittest.main()
