"""Deterministic synthetic forecast fixtures. Never use these values for real decisions."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import atan2, cos, exp, pi, sin, sqrt
from typing import Any

RUN = "2026-09-27T00:00:00Z"
REPLAY_RUN = "2020-05-14T00:00:00Z"
PROVENANCE = {
    "kind": "simulated",
    "source": "SIH synthetic demonstration dataset",
    "model": "Global ensemble · 23 synthetic members",
    "run": RUN,
    "disclaimer": "Simulated demonstration data. Not an official forecast or validated AI output.",
}
SEEDS: list[dict[str, Any]] = [
    dict(id="WX-024", type="cyclone", name="Cyclonic system", region="Bay of Bengal", severity="SEVERE", confidence=87, status="Intensifying", trend="intensifying", leadTime=42, centroid=[87.1, 18.8]),
    dict(id="WX-025", type="rainfall", name="Extreme rainfall", region="Western Ghats", severity="HIGH", confidence=81, status="Developing", trend="intensifying", leadTime=30, centroid=[74.5, 14.6]),
    dict(id="WX-026", type="heat", name="Heat anomaly", region="Rajasthan · Gujarat", severity="MODERATE", confidence=64, status="Persistent", trend="stable", leadTime=66, centroid=[72.8, 26.1]),
    dict(id="WX-027", type="cold", name="Cold wave", region="Western Himalayas", severity="MODERATE", confidence=58, status="Weakening", trend="weakening", leadTime=90, centroid=[77.2, 33.2]),
]
DOWNSCALING = [
    dict(id="original", label="Original forecast", resolution=12, peakRainfall=141, wind=112, variance=22.4, percentile99=134, rmse=28.6, mae=21.3, extremeError=25, similarity=0.72, kind="simulated"),
    dict(id="interpolation", label="Bilinear interpolation", resolution=5, peakRainfall=140, wind=111, variance=20.1, percentile99=132, rmse=27.9, mae=20.8, extremeError=25.5, similarity=0.75, kind="interpolated"),
    dict(id="ai", label="AI downscaled", resolution=5, peakRainfall=181, wind=138, variance=39.7, percentile99=173, rmse=12.4, mae=8.7, extremeError=3.7, similarity=0.94, kind="ai-generated"),
]


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def timestamp(hour: int, replay: bool = False) -> str:
    run = REPLAY_RUN if replay else RUN
    return (datetime.fromisoformat(run.replace("Z", "+00:00")) + timedelta(hours=hour)).astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def center_at(event: dict, hour: int) -> list[float]:
    t = (clamp(hour, 72, 240) - 96) / 144
    lon, lat = event["centroid"]
    if event["type"] == "cyclone":
        return [lon + t * 1.4 + sin(t * 3) * .35, lat + t * 6.6]
    return [lon + t * .65, lat + t * (2 if event["type"] == "rainfall" else -.4)]


def metrics_at(event: dict, hour: int) -> dict:
    strength = .65 + sin((clamp(hour, 72, 240) - 72) / 168 * pi) * .55
    kind = event["type"]
    return {
        "rainfall": round((195 if kind == "cyclone" else 168 if kind == "rainfall" else 12) * strength),
        "wind": round((132 if kind == "cyclone" else 36) * strength),
        "pressure": round(1012 - (42 if kind == "cyclone" else 10) * strength),
        "humidity": round(clamp(73 + strength * 13, 0, 100)),
        "temperature": round(39 + strength * 6 if kind == "heat" else -3 - strength * 4 if kind == "cold" else 27.4, 1),
        "anomaly": round(strength * 62),
    }


def trajectory(event: dict) -> list[dict]:
    return [dict(hour=hour, coordinates=center_at(event, hour), timestamp=timestamp(hour), confidence=round(clamp(91 - i * .7, 50, 99)), severity="SEVERE" if 5 < i < 20 else "HIGH", metrics=metrics_at(event, hour)) for i, hour in enumerate(range(72, 241, 6))]


def event_list() -> list[dict]:
    return [dict(**seed, trajectory=trajectory(seed), provenance=PROVENANCE, updatedAt=RUN) for seed in SEEDS]


def get_event(event_id: str) -> dict | None:
    return next((event for event in event_list() if event["id"] == event_id), None)


def irregular_ring(center: list[float], radius: float, hour: float = 96, elongation: float = 1.25) -> list[list[float]]:
    points: list[list[float]] = []
    for i in range(80):
        angle = i / 80 * pi * 2
        r = radius * (1 + sin(angle * 3 + hour / 100) * .15 + cos(angle * 5 - hour / 90) * .08)
        points.append([center[0] + cos(angle) * r + sin(angle) * r * .28, center[1] + sin(angle) * r * elongation])
    return [*points, points[0]]


def frame_for(event: dict, hour: int, replay: bool = False) -> dict:
    center = center_at(event, hour)
    metrics = metrics_at(event, hour)
    phase = sin((hour - 72) / 168 * pi)
    confidence = round(clamp(event["confidence"] + sin((hour - 96) / 55) * 4 - max(0, hour - 144) / 11, 35, 96))
    severity = "SEVERE" if event["type"] == "cyclone" and 90 <= hour <= 192 else "HIGH" if event["type"] == "cyclone" else event["severity"]
    radius = (1.38 if event["type"] == "cyclone" else .95) * (.8 + phase * .35)
    polygons = [
        {"type": "Feature", "properties": {"eventId": event["id"], "severity": label, "probability": (confidence - (2 - i) * 9) / 100, "label": f"{label.capitalize()} core zone" if i == 2 else name}, "geometry": {"type": "Polygon", "coordinates": [irregular_ring(center, radius * factor, hour)]}}
        for i, (label, name, factor) in enumerate(zip(("MODERATE", "HIGH", severity), ("Moderate-risk zone", "High-risk zone", "Core zone"), (1.7, 1.05, .56)))
    ]
    return {
        "hour": hour, "timestamp": timestamp(hour, replay), "centroid": center, "confidence": confidence, "severity": severity, "metrics": metrics, "polygons": polygons,
        "ensemble": {"total": 23, "agreeing": round(confidence / 100 * 23), "spreadKm": round(39 + (hour - 72) * .43), "confidence": confidence, "probability": (confidence - 3) / 100, "trend": 4 if hour < 144 else -3},
        "impact": {"population": round((64000 + phase * 112000) / 100) * 100, "villages": round(12 + phase * 12), "hospitals": round(2 + phase * 2), "schools": round(15 + phase * 14), "roads": round(1 + phase * 2), "bridges": round(2 + phase * 4), "croplandHa": round(4800 + phase * 7200), "riverSections": round(2 + phase * 4)},
    }


def distance_km(a: list[float], b: list[float]) -> float:
    rad = pi / 180
    p = sin((b[1] - a[1]) * rad / 2) ** 2 + cos(a[1] * rad) * cos(b[1] * rad) * sin((b[0] - a[0]) * rad / 2) ** 2
    return 6371 * 2 * atan2(sqrt(p), sqrt(max(0, 1 - p)))


def risk_for(event: dict, coordinates: list[float], name: str, hour: int, replay: bool = False) -> dict:
    frame = frame_for(event, hour, replay)
    distance = distance_km(coordinates, frame["centroid"])
    strength = exp(-distance / 260)
    probability = round(frame["confidence"] * strength) / 100
    severity = "SEVERE" if probability > .7 else "HIGH" if probability > .45 else "MODERATE" if probability > .18 else "LOW"
    lead = event["leadTime"] - (hour - 96)
    return {"name": name, "coordinates": coordinates, "eventId": event["id"], "severity": severity, "probability": probability, "rainfall": {"min": round(frame["metrics"]["rainfall"] * strength * .8), "max": round(frame["metrics"]["rainfall"] * strength * 1.2)}, "wind": round(frame["metrics"]["wind"] * strength), "arrivalHours": [max(0, lead), max(6, lead + 6)], "confidence": frame["confidence"], "distanceKm": round(distance), "impact": "Limited modeled exposure to this event" if severity == "LOW" else "Potential localized flooding, strong winds, and transport disruption", "provenance": {**PROVENANCE, "run": REPLAY_RUN if replay else RUN}}


def alerts_for(events: list[dict]) -> list[dict]:
    alerts: list[dict] = []
    for i, event in enumerate(events):
        frame = frame_for(event, 96)
        alerts.append({"id": f"ALT-{1048 + i}", "eventId": event["id"], "title": f"{event['name']} advisory", "region": event["region"], "coordinates": frame["centroid"], "severity": frame["severity"], "confidence": frame["confidence"], "leadHours": event["leadTime"], "timestamp": RUN, "forecastWindow": frame["timestamp"], "rainfall": frame["metrics"]["rainfall"], "wind": frame["metrics"]["wind"], "population": frame["impact"]["population"], "polygon": frame["polygons"][1], "acknowledged": False, "provenance": PROVENANCE})
    return alerts
