"""Read-only contract for dashboard data and future scientific services."""
from __future__ import annotations

import os
import hmac
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .simulation import DOWNSCALING, PROVENANCE, alerts_for, event_list, frame_for, get_event, risk_for


class Health(BaseModel):
    status: str
    mode: str
    services: dict[str, str]
    trained_models: bool


app = FastAPI(title="Weather Intelligence AI", version="0.1.0", description="SIH prototype API. Demo responses are deterministic synthetic data, never official forecasts.")
allowed_origins = [v.strip() for v in os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",") if v.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=False, allow_methods=["GET"], allow_headers=["Content-Type"])


@app.middleware("http")
async def optional_gateway_auth(request: Request, call_next):
    """Require the Worker's bearer token when the backend is hosted for API mode."""
    configured = os.getenv("BACKEND_TOKEN", "")
    if configured and request.url.path.startswith("/api/") and request.method != "OPTIONS":
        supplied = request.headers.get("Authorization", "")
        if not hmac.compare_digest(supplied, f"Bearer {configured}"):
            return JSONResponse({"detail": "Unauthorized gateway request"}, status_code=401)
    return await call_next(request)


def event_or_404(event_id: str) -> dict:
    event = get_event(event_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")
    return event


@app.get("/api/health", response_model=Health)
def health() -> Health:
    return Health(status="ok", mode="demo", services={"simulation": "ready", "inference": "not_connected", "ncmrwf": "not_connected"}, trained_models=False)


@app.get("/api/events")
def events() -> list[dict]:
    return event_list()


@app.get("/api/events/{event_id}")
def event_detail(event_id: str) -> dict:
    return event_or_404(event_id)


@app.get("/api/forecast")
def forecast(event_id: str = "WX-024", hour: Annotated[int, Query(ge=72, le=240)] = 96, replay: bool = False) -> dict:
    return frame_for(event_or_404(event_id), hour, replay)


@app.get("/api/alerts")
def alerts() -> list[dict]:
    return alerts_for(event_list())


@app.get("/api/risk")
def risk(lat: Annotated[float, Query(ge=-90, le=90)], lon: Annotated[float, Query(ge=-180, le=180)], name: str = "Selected coordinates", event_id: str = "WX-024", hour: Annotated[int, Query(ge=72, le=240)] = 96, replay: bool = False) -> dict:
    return risk_for(event_or_404(event_id), [lon, lat], name, hour, replay)


@app.get("/api/impact")
def impact(event_id: str = "WX-024", hour: Annotated[int, Query(ge=72, le=240)] = 96, replay: bool = False) -> dict:
    event = event_or_404(event_id)
    frame = frame_for(event, hour, replay)
    return {"event_id": event_id, "timestamp": frame["timestamp"], "impact": frame["impact"], "provenance": {**PROVENANCE, "run": event["provenance"]["run"]}}


@app.get("/api/trajectory/{event_id}")
def trajectory(event_id: str) -> list[dict]:
    return event_or_404(event_id)["trajectory"]


@app.get("/api/downscaled/{event_id}")
def downscaled(event_id: str) -> list[dict]:
    event_or_404(event_id)
    return DOWNSCALING


@app.get("/api/inference/status")
def inference_status() -> dict:
    return {"available": False, "reason": "No trained GNN or conditional diffusion weights are configured", "data_kind": "simulated"}
