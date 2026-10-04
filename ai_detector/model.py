"""The trained detector: standardisation + logistic regression, stored as plain numpy arrays."""
import json
import os

import numpy as np

from .features import FEATURE_SIZE

MODEL_PATH = os.environ.get("OHMWAVE_AI_MODEL", "models/ai_detector.npz")


class AIMusicModel:
    def __init__(self, mean, scale, coef, intercept, threshold, info=None):
        self.mean = np.asarray(mean, dtype=np.float64)
        self.scale = np.asarray(scale, dtype=np.float64)
        self.coef = np.asarray(coef, dtype=np.float64)
        self.intercept = float(intercept)
        self.threshold = float(threshold)
        self.info = info or {}
        if not (self.mean.shape == self.scale.shape == self.coef.shape == (FEATURE_SIZE,)):
            raise ValueError("This model was made for a different feature size.")

    @property
    def version(self):
        return self.info.get("version", "unknown")

    def probability(self, features):
        """Chance (0–1) that the song is AI-generated."""
        z = ((np.asarray(features, dtype=np.float64) - self.mean) / self.scale) @ self.coef + self.intercept
        return float(1 / (1 + np.exp(-np.clip(z, -50, 50))))

    def is_ai(self, probability):
        return probability >= self.threshold

    def save(self, path=MODEL_PATH):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        np.savez(path, mean=self.mean, scale=self.scale, coef=self.coef, intercept=self.intercept,
                 threshold=self.threshold, info=json.dumps(self.info))

    @classmethod
    def load(cls, path=MODEL_PATH):
        # allow_pickle stays off: the file holds only numbers and a JSON string.
        with np.load(path, allow_pickle=False) as data:
            return cls(data["mean"], data["scale"], data["coef"], data["intercept"], data["threshold"],
                       json.loads(str(data["info"])))
