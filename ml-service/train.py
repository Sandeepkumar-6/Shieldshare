import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split

from feature_contract import FEATURES

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
MODELS = ROOT / "models"


def normalized(raw: np.ndarray, threshold: float, p01: float) -> np.ndarray:
    denominator = threshold - p01
    if denominator <= 0:
        raise ValueError("Training scores did not produce a usable normalization range")
    return np.clip((threshold - raw) / denominator, 0, 1)


if __name__ == "__main__":
    normal = pd.read_csv(DATA / "synthetic_normal.csv", comment="#")[FEATURES]
    attack = pd.read_csv(DATA / "synthetic_attack_like.csv", comment="#")[FEATURES]
    train, held_out = train_test_split(normal, test_size=0.2, random_state=20260925)
    # The normalization uses the training p01 below the decision threshold. A 2% decision
    # boundary keeps that range non-zero while remaining a small expected outlier share.
    model = IsolationForest(n_estimators=200, contamination=0.02, random_state=20260925, n_jobs=-1)
    model.fit(train)
    raw_training = model.score_samples(train)
    threshold = float(model.offset_)
    p01 = float(np.percentile(raw_training, 1))
    model_version = f"if-{datetime.now(timezone.utc).date().isoformat()}-synthetic"

    MODELS.mkdir(exist_ok=True)
    joblib.dump(model, MODELS / "model.joblib")
    meta = {
        "features": FEATURES, "threshold": threshold, "p01": p01,
        "training_rows": int(len(train)), "dataset": "synthetic",
        "trained_at": datetime.now(timezone.utc).isoformat(), "model_version": model_version,
    }
    (MODELS / "model_meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    normal_flagged = float((normalized(model.score_samples(held_out), threshold, p01) > 0).mean())
    attack_flagged = float((normalized(model.score_samples(attack), threshold, p01) > 0).mean())
    report = f"""# Synthetic pipeline sanity check

This is a pipeline sanity check on generated data, **not** a measurement of real-world ransomware accuracy.

- Training data: {len(train)} simulated normal windows
- Held-out synthetic normal windows flagged: {normal_flagged:.1%}
- Synthetic attack-like windows flagged: {attack_flagged:.1%}
- Model: `{model_version}`

The supported claim is: the Isolation Forest was trained on simulated normal activity and flags activity that is anomalous relative to that baseline.
"""
    (ROOT / "eval_report.md").write_text(report, encoding="utf-8")
    print(report)
