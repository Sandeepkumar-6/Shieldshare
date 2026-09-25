from fastapi.testclient import TestClient

from app import app
from feature_contract import FEATURES

client = TestClient(app)


def payload(values):
    return {
        "userId": "test-user",
        "windowStart": "2026-09-25T10:00:00Z",
        "windowEnd": "2026-09-25T10:01:00Z",
        "features": dict(zip(FEATURES, values, strict=True)),
    }


def test_health_and_score_shape():
    assert client.get("/health").status_code == 200
    response = client.post("/score", json=payload([5, 2, 0.2, 0, 1, 0, 0.1, 0.2, 0.25, 12000]))
    assert response.status_code == 200
    assert set(response.json()) == {"anomalyScore", "isAnomaly", "raw", "modelVersion"}


def test_feature_order_mismatch_is_422():
    body = payload([0] * len(FEATURES))
    body["features"] = {name: 0 for name in reversed(FEATURES)}
    assert client.post("/score", json=body).status_code == 422


def test_normal_low_and_extreme_burst_high():
    normal = client.post("/score", json=payload([5, 2, 0.2, 0, 1, 0, 0.1, 0.2, 0.25, 12000])).json()
    burst = client.post("/score", json=payload([100, 55, 30, 8, 8, 24, 2.5, 3.8, 0.95, 150])).json()
    assert normal["anomalyScore"] <= 0.25
    assert burst["anomalyScore"] >= 0.5
