"""
Train and evaluate the detector: python -m ai_detector.train

Songs are split by artist, so the test score measures what matters in the app: recognising AI songs from
artists the model has never heard. The decision threshold is chosen on training data to keep false alarms
(human songs hidden as AI) at or below --max-false-positive-rate, then checked on the held-out artists.
"""
import argparse
import json
import os
from datetime import datetime, timezone

import numpy as np

from .build_dataset import DATA_DIR
from .features import FEATURE_SIZE
from .model import MODEL_PATH, AIMusicModel

REPORT_PATH = os.path.splitext(MODEL_PATH)[0] + "_report.json"


def load_dataset(data_dir=DATA_DIR):
    songs = {}  # videoId -> row; a song collected twice counts once
    with open(os.path.join(data_dir, "manifest.jsonl")) as handle:
        for line in handle:
            row = json.loads(line)
            path = os.path.join(data_dir, "features", f"{row['videoId']}.npy")
            if not row.get("error") and os.path.exists(path):
                songs[row["videoId"]] = row
    rows, vectors = [], []
    for row in songs.values():
        vector = np.load(os.path.join(data_dir, "features", f"{row['videoId']}.npy"))
        if vector.shape == (FEATURE_SIZE,):
            rows.append(row)
            vectors.append(vector)
    X = np.stack(vectors)
    y = np.array([r["label"] for r in rows])
    groups = np.array([r["group"] for r in rows])
    return rows, X, y, groups


def threshold_for(y, scores, max_fpr):
    """Lowest threshold whose false-positive rate stays within max_fpr (catching as much AI as possible)."""
    human = np.sort(scores[y == 0])
    if not len(human):
        return 0.5
    allowed = int(np.floor(max_fpr * len(human)))  # human songs we may wrongly flag
    return float(np.nextafter(human[len(human) - allowed - 1], 1.0))


def metrics(y, scores, threshold):
    from sklearn.metrics import roc_auc_score
    predicted = scores >= threshold
    tp = int(((y == 1) & predicted).sum()); fp = int(((y == 0) & predicted).sum())
    fn = int(((y == 1) & ~predicted).sum()); tn = int(((y == 0) & ~predicted).sum())
    return {
        "songs": int(len(y)), "ai_songs": int((y == 1).sum()), "human_songs": int((y == 0).sum()),
        "accuracy": round((tp + tn) / max(1, len(y)), 4),
        "ai_caught": round(tp / max(1, tp + fn), 4),                # recall
        "human_wrongly_flagged": round(fp / max(1, fp + tn), 4),    # false-positive rate
        "precision": round(tp / max(1, tp + fp), 4),
        "roc_auc": round(float(roc_auc_score(y, scores)), 4) if len(set(y)) == 2 else None,
        "confusion": {"ai_caught": tp, "ai_missed": fn, "human_flagged": fp, "human_passed": tn},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-false-positive-rate", type=float, default=0.02,
                        help="share of human songs the app may hide by mistake (default 2%%)")
    parser.add_argument("--test-share", type=float, default=0.25)
    args = parser.parse_args()

    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import GroupKFold, GroupShuffleSplit, cross_val_predict
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    rows, X, y, groups = load_dataset()
    print(f"{len(y)} songs: {int(y.sum())} AI from {len(set(groups[y == 1]))} artists, "
          f"{int((y == 0).sum())} human from {len(set(groups[y == 0]))} artists.")
    if min(int(y.sum()), int((y == 0).sum())) < 20:
        raise SystemExit("Not enough songs yet: collect more with python -m ai_detector.build_dataset.")

    def model(C):
        return make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=5000, class_weight="balanced"))

    def out_of_fold(C, idx):
        folds = GroupKFold(n_splits=5)
        return cross_val_predict(model(C), X[idx], y[idx], groups=groups[idx], cv=folds, method="predict_proba")[:, 1]

    train_idx, test_idx = next(GroupShuffleSplit(n_splits=1, test_size=args.test_share, random_state=3).split(X, y, groups))

    # Pick regularisation on the training artists only.
    from sklearn.metrics import roc_auc_score
    candidates = [0.0003, 0.001, 0.003, 0.01, 0.03, 0.1]
    cv_auc = {C: roc_auc_score(y[train_idx], out_of_fold(C, train_idx)) for C in candidates}
    best_C = max(cv_auc, key=cv_auc.get)
    print("Cross-validated ROC AUC by C:", {c: round(a, 4) for c, a in cv_auc.items()}, "→ C =", best_C)

    threshold = threshold_for(y[train_idx], out_of_fold(best_C, train_idx), args.max_false_positive_rate)
    held_out = model(best_C).fit(X[train_idx], y[train_idx])
    test = metrics(y[test_idx], held_out.predict_proba(X[test_idx])[:, 1], threshold)
    print("Held-out artists:", json.dumps(test, indent=2))

    # Final model: all data, same settings, threshold re-derived from all out-of-fold scores.
    all_idx = np.arange(len(y))
    final_threshold = threshold_for(y, out_of_fold(best_C, all_idx), args.max_false_positive_rate)
    final = model(best_C).fit(X, y)
    scaler, logistic = final.named_steps["standardscaler"], final.named_steps["logisticregression"]
    version = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    info = {"version": version, "C": best_C, "songs": int(len(y)), "max_false_positive_rate": args.max_false_positive_rate,
            "held_out": test, "data_credit": "AI artist data by Soul Over AI (https://souloverai.com), CC BY 4.0."}
    AIMusicModel(scaler.mean_, np.where(scaler.scale_ > 0, scaler.scale_, 1.0), logistic.coef_[0], logistic.intercept_[0],
                 final_threshold, info).save(MODEL_PATH)
    with open(REPORT_PATH, "w") as handle:
        json.dump({**info, "threshold": final_threshold, "cv_roc_auc": {str(k): v for k, v in cv_auc.items()}}, handle, indent=2)
    print(f"Saved model {version} to {MODEL_PATH} (threshold {final_threshold:.3f}); report in {REPORT_PATH}.")


if __name__ == "__main__":
    main()
