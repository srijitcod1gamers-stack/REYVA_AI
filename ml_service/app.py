"""Private FastAPI inference service behind the TypeScript Cloudflare Worker."""

import hashlib
import hmac
import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
from fastapi import Depends, FastAPI, Header, HTTPException, Query

from .data import open_field, precipitation_mm, valid_time
from .model import generate

app = FastAPI(title="Weather Intelligence ML", docs_url=None, redoc_url=None)


def authorize(x_internal_key: str | None = Header(default=None)):
    key = os.getenv("ML_INTERNAL_KEY")
    if not key or not x_internal_key or not hmac.compare_digest(x_internal_key, key):
        raise HTTPException(status_code=401, detail="Unauthorized")


def validated_artifact():
    directory = Path(os.getenv("ML_ARTIFACT_DIR", "ml_service/artifacts"))
    report_path = directory / "validation.json"
    if not report_path.exists():
        raise HTTPException(status_code=503, detail="No validated model artifact is installed")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if not report.get("approved") or len(report.get("test_events", [])) < 2:
        raise HTTPException(status_code=503, detail="Model has not passed held-out validation")
    checkpoint = directory / "model" / "diffusion_pytorch_model.safetensors"
    if not checkpoint.exists():
        checkpoint = directory / "model" / "diffusion_pytorch_model.bin"
    if not checkpoint.exists() or hashlib.sha256(checkpoint.read_bytes()).hexdigest() != report.get(
        "checkpoint_sha256"
    ):
        raise HTTPException(status_code=503, detail="Model checkpoint does not match validation report")
    return directory, report


def validated_tracker(directory: Path):
    report_path = directory / "tracker-validation.json"
    checkpoint = directory / "tracker.pt"
    if not report_path.exists() or not checkpoint.exists():
        raise HTTPException(status_code=503, detail="No validated graph tracker is installed")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if not report.get("approved") or len(report.get("test_events", [])) < 2:
        raise HTTPException(status_code=503, detail="Graph tracker has not passed held-out validation")
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != report.get("checkpoint_sha256"):
        raise HTTPException(status_code=503, detail="Graph checkpoint does not match its validation report")
    return report


@lru_cache(maxsize=1)
def load_model(directory: str):
    from diffusers import UNet2DModel

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = UNet2DModel.from_pretrained(Path(directory) / "model").to(device)
    scheduler_path = Path(directory) / "scheduler"
    return model, str(scheduler_path), device


def catalog_run(event_id: str, hour: int):
    catalog_path = Path(os.getenv("ML_LIVE_CATALOG", "ml_service/live-catalog.json"))
    if not catalog_path.exists():
        raise HTTPException(status_code=503, detail="No gridded live forecast catalog is connected")
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    for run in catalog.get("runs", []):
        if run.get("event_id") == event_id and run.get("hour") == hour:
            return run
    raise HTTPException(status_code=404, detail="No gridded forecast for this event and lead hour")


@lru_cache(maxsize=1)
def load_tracker(directory: str, fields: int):
    from .tracking import SphericalTracker

    model = SphericalTracker(fields)
    model.load_state_dict(torch.load(Path(directory) / "tracker.pt", map_location="cpu", weights_only=True))
    model.eval()
    return model


@app.get("/v1/status", dependencies=[Depends(authorize)])
def status():
    try:
        _, report = validated_artifact()
        model = {
            "ready": True,
            "method": report["method"],
            "test": report["test"],
            "checkpoint_sha256": report["checkpoint_sha256"],
            "trained_at": report["trained_at"],
            "validation_scope": report.get("validation_scope", "unspecified"),
        }
    except HTTPException:
        model = {"ready": False}
    try:
        tracker_report = validated_tracker(Path(os.getenv("ML_ARTIFACT_DIR", "ml_service/artifacts")))
        tracker = {
            "ready": True,
            "test": tracker_report["test"],
            "validation_scope": tracker_report.get("validation_scope", "unspecified"),
        }
    except HTTPException:
        tracker = {"ready": False}
    return {
        "service": "weather-ml",
        "model": model,
        "tracker": tracker,
        "live_catalog_connected": Path(
            os.getenv("ML_LIVE_CATALOG", "ml_service/live-catalog.json")
        ).exists(),
    }


@app.get("/v1/track/{event_id}", dependencies=[Depends(authorize)])
def track(event_id: str, hour: int = Query(ge=72, le=240)):
    from .tracking import spherical_grid_graph

    directory = Path(os.getenv("ML_ARTIFACT_DIR", "ml_service/artifacts"))
    report = validated_tracker(directory)
    catalog_path = Path(os.getenv("ML_LIVE_CATALOG", "ml_service/live-catalog.json"))
    if not catalog_path.exists():
        raise HTTPException(status_code=503, detail="No gridded live forecast catalog is connected")
    runs = json.loads(catalog_path.read_text(encoding="utf-8")).get("tracking_runs", [])
    run = next((item for item in runs if item.get("event_id") == event_id and item.get("hour") == hour), None)
    if not run:
        raise HTTPException(status_code=404, detail="No graph input for this event and lead hour")
    if [item["variable"] for item in run["fields"]] != report["fields"]:
        raise HTTPException(status_code=422, detail="Live graph variables differ from trained model")
    arrays = [
        open_field(item["path"], item["variable"], run.get("bounds"))
        for item in run["fields"]
    ]
    expected = np.datetime64(str(run["valid_time"]).replace("Z", ""), "s")
    if any(valid_time(array) != expected for array in arrays):
        raise HTTPException(status_code=422, detail="Live graph fields have mismatched valid times")
    first = arrays[0]
    if first.size > 20_000 or any(
        not np.array_equal(item.lat, first.lat) or not np.array_equal(item.lon, first.lon)
        for item in arrays[1:]
    ):
        raise HTTPException(status_code=422, detail="Live graph grids do not align")
    features = np.stack([np.asarray(item.values, dtype=np.float32) for item in arrays], axis=-1)
    if not np.isfinite(features).all():
        raise HTTPException(status_code=422, detail="Live graph has missing values")
    means = np.asarray(report["means"], dtype=np.float32)
    scales = np.asarray(report["scales"], dtype=np.float32)
    graph = spherical_grid_graph(np.asarray(first.lat), np.asarray(first.lon))
    values = torch.from_numpy(((features - means) / scales).reshape(-1, len(means)))
    with torch.no_grad():
        scores = torch.sigmoid(load_tracker(str(directory.resolve()), len(means))(graph, values))
    mask = scores.numpy().reshape(features.shape[:2]) >= float(
        report.get("decision_threshold", 0.5)
    )
    if not mask.any():
        return {
            "event_id": event_id,
            "hour": hour,
            "detected": False,
            "validation": report["test"],
            "validation_scope": report.get("validation_scope", "unspecified"),
        }
    ys, xs = np.where(mask)
    return {
        "event_id": event_id,
        "hour": hour,
        "detected": True,
        "valid_time": run["valid_time"],
        "centroid": [float(np.mean(first.lon.values[xs])), float(np.mean(first.lat.values[ys]))],
        "bounds": [
            float(first.lon.values[xs.min()]), float(first.lat.values[ys.min()]),
            float(first.lon.values[xs.max()]), float(first.lat.values[ys.max()]),
        ],
        "screened_cells": int(mask.sum()),
        "cell_spacing_degrees": [
            float(np.median(np.diff(first.lon.values))),
            float(np.median(np.diff(first.lat.values))),
        ],
        "validation": report["test"],
        "validation_scope": report.get("validation_scope", "unspecified"),
    }


@app.get("/v1/downscaled/{event_id}", dependencies=[Depends(authorize)])
def downscaled(
    event_id: str,
    hour: int = Query(ge=72, le=240),
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
):
    directory, report = validated_artifact()
    run = catalog_run(event_id, hour)
    if int(run.get("accumulation_hours", 0)) != report["accumulation_hours"]:
        raise HTTPException(status_code=422, detail="Live accumulation window differs from training")
    try:
        crop = [lon - 1.7, lat - 1.7, lon + 1.7, lat + 1.7]
        coarse = precipitation_mm(open_field(run["forecast"], run["variable"], crop))
        expected_time = np.datetime64(str(run["valid_time"]).replace("Z", ""), "s")
        if valid_time(coarse) != expected_time:
            raise ValueError("Live forecast valid time differs from catalog")
        latitudes = lat + (np.arange(64, dtype=np.float32) - 31.5) * 0.05
        longitudes = lon + (np.arange(64, dtype=np.float32) - 31.5) * 0.05
        tile = coarse.interp(lat=latitudes, lon=longitudes, method="linear")
        array = np.asarray(tile.values, dtype=np.float32)
        if not np.isfinite(array).all():
            raise ValueError("Requested area falls outside the gridded forecast")
        from diffusers import DDPMScheduler

        model, scheduler_path, device = load_model(str(directory.resolve()))
        scheduler = DDPMScheduler.from_pretrained(scheduler_path)
        field = generate(
            model,
            scheduler,
            torch.from_numpy(array)[None, None].to(device),
            max_mm=float(report["output_cap_mm"]),
            residual_weight=float(report.get("residual_weight", 1.0)),
        )[0, 0].cpu()
        if not torch.isfinite(field).all() or (field < 0).any():
            raise ValueError("Model output contains invalid rainfall values")
    except (KeyError, ValueError, OSError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {
        "event_id": event_id,
        "hour": hour,
        "valid_time": run["valid_time"],
        "variable": "accumulated_precipitation_mm",
        "accumulation_hours": report["accumulation_hours"],
        "resolution_degrees": 0.05,
        "method": report["method"],
        "source": run["source"],
        "validation": report["test"],
        "validation_scope": report.get("validation_scope", "unspecified"),
        "bounds": [
            float(longitudes[0] - 0.025), float(latitudes[0] - 0.025),
            float(longitudes[-1] + 0.025), float(latitudes[-1] + 0.025),
        ],
        "width": 64,
        "height": 64,
        "values": field.numpy().round(2).tolist(),
    }
