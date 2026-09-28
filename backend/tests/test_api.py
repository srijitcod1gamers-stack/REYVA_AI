from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_contract_and_provenance():
    events = client.get("/api/events")
    assert events.status_code == 200
    assert len(events.json()) == 4
    assert events.json()[0]["provenance"]["kind"] == "simulated"
    frame = client.get("/api/forecast?event_id=WX-024&hour=96")
    assert frame.status_code == 200
    assert len(frame.json()["polygons"]) == 3
    assert frame.json()["polygons"][0]["geometry"]["type"] == "Polygon"
    assert frame.json()["centroid"] != client.get("/api/forecast?event_id=WX-024&hour=144").json()["centroid"]


def test_risk_and_validation():
    risk = client.get("/api/risk?lat=22.57&lon=88.36")
    assert risk.status_code == 200
    assert risk.json()["provenance"]["kind"] == "simulated"
    assert client.get("/api/risk?lat=100&lon=88").status_code == 422
    assert client.get("/api/forecast?hour=1000").status_code == 422
    assert client.get("/api/events/WX-NOPE").status_code == 404
    assert client.get("/api/inference/status").json()["available"] is False


def test_hosted_api_can_require_gateway_token(monkeypatch):
    monkeypatch.setenv("BACKEND_TOKEN", "example-test-token")
    assert client.get("/api/events").status_code == 401
    authorized = client.get("/api/events", headers={"Authorization": "Bearer example-test-token"})
    assert authorized.status_code == 200
