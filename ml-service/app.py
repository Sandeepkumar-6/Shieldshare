import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from feature_contract import FEATURES

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "models" / "model.joblib"
META_PATH = ROOT / "models" / "model_meta.json"
model = joblib.load(MODEL_PATH) if MODEL_PATH.exists() else None
meta = json.loads(META_PATH.read_text(encoding="utf-8")) if META_PATH.exists() else None
app = FastAPI(title="ShieldShare ML service", version="1.0.0")


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    userId: str = Field(min_length=1, max_length=128)
    windowStart: str
    windowEnd: str
    features: dict[str, float]

    @model_validator(mode="after")
    def feature_contract(self):
        if list(self.features.keys()) != FEATURES:
            raise ValueError(f"features must match this exact order: {FEATURES}")
        if not all(np.isfinite(value) for value in self.features.values()):
            raise ValueError("feature values must be finite")
        return self


@app.get("/health")
def health():
    if model is None or meta is None:
        raise HTTPException(status_code=503, detail="model unavailable")
    return {"status": "ok", "modelVersion": meta["model_version"], "dataset": meta["dataset"], "features": FEATURES}


@app.post("/score")
def score(request: ScoreRequest):
    if model is None or meta is None:
        raise HTTPException(status_code=503, detail="model unavailable")
    values = pd.DataFrame([[request.features[name] for name in FEATURES]], columns=FEATURES, dtype=float)
    raw = float(model.score_samples(values)[0])
    denominator = meta["threshold"] - meta["p01"]
    anomaly = float(np.clip((meta["threshold"] - raw) / denominator, 0, 1)) if denominator > 0 else 0.0
    return {"anomalyScore": anomaly, "isAnomaly": anomaly > 0, "raw": raw, "modelVersion": meta["model_version"]}
