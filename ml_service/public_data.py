"""Prepare public NOAA GEFS + CHIRPS data for the validated ML pipeline.

The module intentionally keeps download, normalization and catalog generation
separate from training. It never creates an approved artifact: only train.py and
train_tracker.py can do that after their held-out validation gates pass.
"""

from __future__ import annotations

import argparse
import json
import re
import tempfile
import time
import warnings
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.client import RemoteDisconnected
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import numpy as np
import xarray as xr
import cfgrib

from .efi import extreme_forecast_index


REFORECAST_ROOT = "https://noaa-gefs-retrospective.s3.amazonaws.com/GEFSv12/reforecast"
OPERATIONAL_ROOT = "https://noaa-gefs-pds.s3.amazonaws.com"
CHIRPS_ROOT = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/final/rnl/cogs"
MEMBERS = ("c00", "p01", "p02", "p03", "p04")
QUANTILES = np.linspace(0.05, 0.95, 19, dtype=np.float32)
ACCUMULATION_RE = re.compile(r":(\d+)-(\d+) hour acc fcst:")
LEAD_RE = re.compile(r":(\d+) hour fcst:")
RETRYABLE_HTTP_CODES = {408, 425, 429, 500, 502, 503, 504}
NETWORK_ATTEMPTS = 6


@dataclass(frozen=True)
class IndexRecord:
    offset: int
    description: str
    end: int | None = None


def request_bytes(url: str, byte_range: tuple[int, int] | None = None) -> bytes:
    headers = {"User-Agent": "REYVA-AI-SIH/1.0 (public weather data research)"}
    if byte_range is not None:
        headers["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
    for attempt in range(NETWORK_ATTEMPTS):
        try:
            with urlopen(Request(url, headers=headers), timeout=90) as response:
                return response.read()
        except HTTPError as error:
            if error.code not in RETRYABLE_HTTP_CODES or attempt + 1 == NETWORK_ATTEMPTS:
                raise
        except (URLError, RemoteDisconnected, TimeoutError, ConnectionError, OSError):
            if attempt + 1 == NETWORK_ATTEMPTS:
                raise
        delay = min(30, 2**attempt)
        print(
            f"[network] request interrupted; retry {attempt + 2}/{NETWORK_ATTEMPTS} in {delay}s",
            flush=True,
        )
        time.sleep(delay)
    raise RuntimeError("Network retry loop ended unexpectedly")


def request_text(url: str) -> str:
    return request_bytes(url).decode("utf-8")


def parse_index(text: str) -> list[IndexRecord]:
    """Parse wgrib2 index text and derive each message's inclusive byte end."""
    rows: list[tuple[int, str]] = []
    for line in text.splitlines():
        parts = line.strip().split(":", 2)
        if len(parts) != 3:
            continue
        try:
            rows.append((int(parts[1]), ":" + parts[2]))
        except ValueError:
            continue
    if not rows:
        raise ValueError("NOAA index contains no GRIB messages")
    if any(rows[index][0] >= rows[index + 1][0] for index in range(len(rows) - 1)):
        raise ValueError("NOAA index offsets are not strictly increasing")
    return [
        IndexRecord(offset, description, rows[index + 1][0] - 1 if index + 1 < len(rows) else None)
        for index, (offset, description) in enumerate(rows)
    ]


def select_accumulation(records: list[IndexRecord], start_hour: int, end_hour: int) -> list[IndexRecord]:
    candidates: dict[int, list[tuple[int, IndexRecord]]] = {}
    for record in records:
        match = ACCUMULATION_RE.search(record.description)
        if match:
            start, end = map(int, match.groups())
            if start >= start_hour and end <= end_hour:
                candidates.setdefault(start, []).append((end, record))
    selected: list[IndexRecord] = []
    cursor = start_hour
    while cursor < end_hour:
        choices = [choice for choice in candidates.get(cursor, []) if choice[0] <= end_hour]
        if not choices:
            raise ValueError(f"No complete {start_hour}-{end_hour} hour accumulation in NOAA index")
        next_hour, record = max(choices, key=lambda choice: choice[0])
        selected.append(record)
        cursor = next_hour
    if cursor != end_hour:
        raise ValueError(f"No complete {start_hour}-{end_hour} hour accumulation in NOAA index")
    return selected


def select_instant(records: list[IndexRecord], variable: str, lead_hour: int) -> IndexRecord:
    candidates = []
    token = f":{variable}:"
    for record in records:
        match = LEAD_RE.search(record.description)
        if token in record.description and match and int(match.group(1)) == lead_hour:
            candidates.append(record)
    if len(candidates) != 1:
        raise ValueError(f"Expected one {variable} message for lead {lead_hour}, found {len(candidates)}")
    return candidates[0]


def download_records(url: str, records: list[IndexRecord], destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        for record in records:
            if record.end is None:
                # The final message has no following offset; a suffix request is
                # unnecessary for the variables used here, but make it explicit.
                raise ValueError("Cannot range-download the final unbounded GRIB message")
            output.write(request_bytes(url, (record.offset, record.end)))
    return destination


def reforecast_url(initialization: datetime, member: str, variable: str) -> str:
    stamp = initialization.strftime("%Y%m%d%H")
    year = initialization.strftime("%Y")
    filename = f"{variable}_{stamp}_{member}.grib2"
    path = f"{year}/{stamp}/{member}/Days:1-10/{filename}"
    return f"{REFORECAST_ROOT}/{quote(path, safe='/._-')}"


def operational_url(initialization: datetime, member: str, lead_hour: int) -> str:
    date = initialization.strftime("%Y%m%d")
    cycle = initialization.strftime("%H")
    prefix = "gec00" if member == "c00" else f"gep{member[1:]}"
    filename = f"{prefix}.t{cycle}z.pgrb2s.0p25.f{lead_hour:03d}"
    return f"{OPERATIONAL_ROOT}/gefs.{date}/{cycle}/atmos/pgrb2sp25/{filename}"


def chirps_url(day: datetime) -> str:
    stamp = day.strftime("%Y.%m.%d")
    return f"{CHIRPS_ROOT}/{day:%Y}/chirps-v3.0.rnl.{stamp}.cog"


def _first_field(path: Path) -> xr.DataArray:
    datasets = cfgrib.open_datasets(path, backend_kwargs={"indexpath": ""})
    try:
        candidates = [field for dataset in datasets for field in dataset.data_vars.values()]
        if not candidates:
            raise ValueError(f"No data field decoded from {path.name}")
        field = candidates[0].load()
    finally:
        for dataset in datasets:
            dataset.close()
    return field


def _canonical_grid(field: xr.DataArray, bounds: list[float]) -> xr.DataArray:
    rename = {}
    if "latitude" in field.coords:
        rename["latitude"] = "lat"
    if "longitude" in field.coords:
        rename["longitude"] = "lon"
    field = field.rename(rename)
    if "lon" not in field.coords or "lat" not in field.coords:
        raise ValueError("Decoded field lacks latitude/longitude coordinates")
    longitude = ((field.lon + 180) % 360) - 180
    field = field.assign_coords(lon=longitude).sortby("lat").sortby("lon")
    west, south, east, north = bounds
    field = field.sel(lat=slice(south, north), lon=slice(west, east))
    if not field.sizes.get("lat") or not field.sizes.get("lon"):
        raise ValueError("Requested bounds do not overlap the NOAA field")
    return field


def _decode_precipitation(path: Path, bounds: list[float]) -> xr.DataArray:
    field = _canonical_grid(_first_field(path), bounds)
    dimensions = [name for name in ("step", "valid_time") if name in field.dims]
    if dimensions:
        field = field.sum(dim=dimensions)
    unit = str(field.attrs.get("units", ""))
    if unit in {"m", "metre", "meter"}:
        field = field * 1000
    elif unit not in {"mm", "kg m**-2", "kg m-2", "kg/m^2"}:
        raise ValueError(f"Unexpected NOAA precipitation unit {unit!r}")
    field.attrs = {"units": "mm", "source_variable": "NOAA GEFS APCP"}
    return field.astype(np.float32)


def _decode_instant(path: Path, bounds: list[float], unit: str) -> xr.DataArray:
    field = _canonical_grid(_first_field(path), bounds)
    for dimension in ("step", "valid_time"):
        if dimension in field.dims:
            if field.sizes[dimension] != 1:
                raise ValueError(f"Expected one {dimension} in {path.name}")
            field = field.isel({dimension: 0})
    field.attrs = {"units": unit}
    return field.astype(np.float32)


def _with_valid_time(field: xr.DataArray, valid_time: datetime, name: str) -> xr.DataArray:
    clean = field.drop_vars(
        [name for name in ("time", "valid_time", "step") if name in field.coords], errors="ignore"
    )
    return clean.rename(name).assign_coords(valid_time=np.datetime64(valid_time.replace(tzinfo=None), "s"))


def _write_field(field: xr.DataArray, path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    field.to_dataset().to_netcdf(partial)
    partial.replace(path)
    return path.as_posix()


def _write_dataset(dataset: xr.Dataset, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    dataset.to_netcdf(partial)
    partial.replace(path)


def fetch_reforecast_member(
    initialization: datetime,
    member: str,
    lead_hour: int,
    accumulation_hours: int,
    variable: str,
    bounds: list[float],
    scratch: Path,
) -> xr.DataArray:
    code = {"precipitation": "apcp_sfc", "wind_gust": "gust_sfc", "pressure_msl": "pres_msl"}[variable]
    url = reforecast_url(initialization, member, code)
    records = parse_index(request_text(url + ".idx"))
    if variable == "precipitation":
        chosen = select_accumulation(records, lead_hour - accumulation_hours, lead_hour)
    else:
        chosen = [select_instant(records, "GUST" if variable == "wind_gust" else "PRES", lead_hour)]
    path = scratch / f"{variable}-{member}.grib2"
    download_records(url, chosen, path)
    return (
        _decode_precipitation(path, bounds)
        if variable == "precipitation"
        else _decode_instant(path, bounds, "m s-1" if variable == "wind_gust" else "Pa")
    )


def ensemble_reforecast(
    initialization: datetime,
    lead_hour: int,
    accumulation_hours: int,
    variable: str,
    bounds: list[float],
    scratch: Path,
) -> xr.DataArray:
    # ecCodes/cfgrib uses a process-global definition scanner. Decoding GRIB
    # members concurrently can corrupt that scanner on Windows, so keep the
    # decode path serial and rely on resumable case caches for robustness.
    fields = [
        fetch_reforecast_member(
            initialization, member, lead_hour, accumulation_hours, variable, bounds, scratch / member
        )
        for member in MEMBERS
    ]
    return xr.concat(fields, dim=xr.IndexVariable("number", np.arange(len(fields)))).astype(np.float32)


def read_chirps(day: datetime, bounds: list[float]) -> xr.DataArray:
    try:
        import rasterio
        from rasterio.windows import from_bounds
    except ImportError as error:
        raise RuntimeError("Install the ml_service dependencies including rasterio") from error
    url = chirps_url(day)
    for attempt in range(NETWORK_ATTEMPTS):
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
                with rasterio.open(url) as source:
                    window = from_bounds(*bounds, transform=source.transform).round_offsets().round_lengths()
                    values = source.read(1, window=window, masked=True)
                    transform = source.window_transform(window)
                    if values.size == 0:
                        raise ValueError("CHIRPS bounds produced an empty grid")
                    rows, columns = values.shape
                    xs = transform.c + (np.arange(columns) + 0.5) * transform.a
                    ys = transform.f + (np.arange(rows) + 0.5) * transform.e
                    data = np.asarray(values.filled(np.nan), dtype=np.float32)
                    data[~np.isfinite(data) | (data < 0)] = np.nan
            break
        except (rasterio.errors.RasterioIOError, RemoteDisconnected, TimeoutError, ConnectionError, OSError):
            if attempt + 1 == NETWORK_ATTEMPTS:
                raise
            delay = min(30, 2**attempt)
            print(
                f"[network] CHIRPS read interrupted; retry {attempt + 2}/{NETWORK_ATTEMPTS} in {delay}s",
                flush=True,
            )
            time.sleep(delay)
    field = xr.DataArray(data, dims=("lat", "lon"), coords={"lat": ys, "lon": xs}).sortby("lat")
    finite = np.isfinite(field.values)
    if finite.mean() < 0.1:
        raise ValueError(f"CHIRPS has insufficient valid land coverage in requested bounds: {url}")
    field.attrs = {"units": "mm", "source": "CHIRPS v3 daily RNL 0.05 degree"}
    return field


def load_manifest(path: Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    bounds = manifest.get("bounds")
    events = manifest.get("events")
    if not isinstance(bounds, list) or len(bounds) != 4 or not bounds[0] < bounds[2] or not bounds[1] < bounds[3]:
        raise ValueError("Manifest bounds must be west, south, east, north")
    if not isinstance(events, list) or len({event.get("event_id") for event in events}) < 10:
        raise ValueError("Public training manifest needs at least ten distinct events")
    for event in events:
        initialization = datetime.fromisoformat(event["initialization"].replace("Z", "+00:00"))
        lead = int(event["lead_hours"])
        if initialization.year < 2000 or initialization.year > 2019 or not 72 <= lead <= 240:
            raise ValueError("Reforecast events must use 2000-2019 initializations and day 3-10 leads")
        if int(event.get("accumulation_hours", 24)) != 24:
            raise ValueError("The public pipeline currently uses one 24-hour rainfall target")
    return manifest


def plan(manifest: dict) -> dict:
    event_months = {
        (datetime.fromisoformat(event["initialization"].replace("Z", "+00:00")) + timedelta(hours=int(event["lead_hours"]))).month
        for event in manifest["events"]
    }
    months = sorted({int(month) for month in manifest.get("climatology_months", event_months)})
    if not months or any(month < 1 or month > 12 for month in months):
        raise ValueError("Climatology months must be integers from 1 to 12")
    missing_event_months = sorted(event_months - set(months))
    if missing_event_months:
        raise ValueError(
            f"Climatology months do not cover event valid-time months: {missing_event_months}"
        )
    years = list(range(int(manifest.get("climatology_start_year", 2000)), 2020))
    days = manifest.get("climatology_days", [5, 15, 25])
    cases = len(years) * len(months) * len(days)
    return {
        "pipeline": "NOAA GEFS v12 reforecast + CHIRPS v3 RNL",
        "bounds": manifest["bounds"],
        "events": len(manifest["events"]),
        "ensemble_members": list(MEMBERS),
        "event_leads": sorted({int(event["lead_hours"]) for event in manifest["events"]}),
        "climatology_years": [years[0], years[-1]],
        "climatology_months": months,
        "climatology_days_per_month": days,
        "climatology_cases": cases,
        "release_gate": "event-held-out model and tracker skill must beat their baselines",
    }


def _climate_dates(manifest: dict) -> dict[int, list[datetime]]:
    details = plan(manifest)
    start, end = details["climatology_years"]
    output: dict[int, list[datetime]] = {}
    for month in details["climatology_months"]:
        output[month] = [
            datetime(year, month, day, tzinfo=timezone.utc) - timedelta(hours=96)
            for year in range(start, end + 1)
            for day in details["climatology_days_per_month"]
        ]
    return output


def prepare_climatology(manifest: dict, root: Path, force: bool = False) -> None:
    bounds = manifest["bounds"]
    for month, initializations in _climate_dates(manifest).items():
        destination = root / "climatology" / f"month-{month:02d}.nc"
        if destination.exists() and not force:
            continue
        forecast_rows, observed_rows = [], []
        for initialization in initializations:
            valid = initialization + timedelta(hours=96)
            case_id = valid.strftime("%Y%m%d")
            print(f"[climatology {month:02d}] {case_id}", flush=True)
            cache_dir = root / "climatology" / "cache" / f"month-{month:02d}"
            forecast_cache = cache_dir / f"{case_id}-gefs.nc"
            observed_cache = cache_dir / f"{case_id}-chirps.nc"
            if force or not forecast_cache.exists():
                with tempfile.TemporaryDirectory(prefix="reyva-climate-") as directory:
                    ensemble = ensemble_reforecast(
                        initialization, 96, 24, "precipitation", bounds, Path(directory)
                    )
                _write_field(_with_valid_time(ensemble, valid, "precipitation"), forecast_cache)
            if force or not observed_cache.exists():
                observation = read_chirps(valid - timedelta(days=1), bounds)
                _write_field(_with_valid_time(observation, valid, "precipitation"), observed_cache)
            with xr.open_dataset(forecast_cache) as dataset:
                forecast_rows.append(dataset["precipitation"].load())
            with xr.open_dataset(observed_cache) as dataset:
                observed_rows.append(dataset["precipitation"].load())
        forecasts = xr.concat(forecast_rows, dim="case")
        observations = xr.concat(observed_rows, dim="case")
        model_quantiles = forecasts.stack(sample=("case", "number")).quantile(QUANTILES, dim="sample")
        # CHIRPS is land-only. Ocean cells are intentionally all-NaN and remain
        # masked downstream, so NumPy's all-NaN quantile warning is expected.
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="All-NaN slice encountered", category=RuntimeWarning)
            observed_quantiles = observations.quantile(QUANTILES, dim="case")
        dataset = xr.Dataset(
            {
                "model_precipitation_quantiles": model_quantiles.astype(np.float32),
                "observed_precipitation_quantiles": observed_quantiles.astype(np.float32),
            },
            attrs={
                "source": "NOAA GEFSv12 reforecasts and CHIRPS v3 RNL",
                "years": "2000-2019",
                "month": month,
                "sampling": "5th, 15th and 25th calendar days; five GEFS members",
            },
        )
        _write_dataset(dataset, destination)
        print(f"[climatology {month:02d}] wrote {destination}", flush=True)


def _interpolate_to(field: xr.DataArray, target: xr.DataArray) -> xr.DataArray:
    return field.interp(lat=target.lat, lon=target.lon, method="linear")


def prepare_events(manifest: dict, root: Path, force: bool = False) -> tuple[Path, Path]:
    training, tracking = [], []
    bounds = manifest["bounds"]
    for event in manifest["events"]:
        event_id = event["event_id"]
        print(f"[event] {event_id}", flush=True)
        initialization = datetime.fromisoformat(event["initialization"].replace("Z", "+00:00"))
        lead = int(event["lead_hours"])
        valid = initialization + timedelta(hours=lead)
        event_dir = root / "events" / event_id
        forecast_path = event_dir / "forecast-precipitation.nc"
        observation_path = event_dir / "observation-precipitation.nc"
        efi_path = event_dir / "forecast-efi.nc"
        gust_path = event_dir / "forecast-wind-gust.nc"
        pressure_path = event_dir / "forecast-pressure-msl.nc"
        mask_path = event_dir / "observed-extreme-mask.nc"
        validity_path = event_dir / "observation-valid-mask.nc"
        required = [forecast_path, observation_path, efi_path, gust_path, pressure_path, mask_path, validity_path]
        if force or not all(path.exists() for path in required):
            with tempfile.TemporaryDirectory(prefix=f"reyva-{event_id}-") as directory:
                scratch = Path(directory)
                precipitation = ensemble_reforecast(initialization, lead, 24, "precipitation", bounds, scratch / "p")
                gust = ensemble_reforecast(initialization, lead, 24, "wind_gust", bounds, scratch / "g").mean("number")
                pressure = ensemble_reforecast(initialization, lead, 24, "pressure_msl", bounds, scratch / "m").mean("number")
            observation = read_chirps(valid - timedelta(days=1), bounds)
            climate_path = root / "climatology" / f"month-{valid.month:02d}.nc"
            if not climate_path.exists():
                raise RuntimeError(f"Missing {climate_path}; run prepare-climatology first")
            with xr.open_dataset(climate_path) as climate:
                model_quantiles = climate["model_precipitation_quantiles"].load()
                observed_p95 = climate["observed_precipitation_quantiles"].sel(
                    quantile=0.95, method="nearest"
                ).load()
            forecast_mean = precipitation.mean("number")
            efi = xr.DataArray(
                extreme_forecast_index(precipitation.values, model_quantiles.values, QUANTILES),
                dims=("lat", "lon"), coords={"lat": precipitation.lat, "lon": precipitation.lon},
                attrs={"units": "1", "source": "GEFS ensemble versus 2000-2019 month-matched model climate"},
            )
            coarse_truth = _interpolate_to(observation, forecast_mean)
            coarse_threshold = _interpolate_to(observed_p95, forecast_mean)
            validity = (np.isfinite(coarse_truth) & np.isfinite(coarse_threshold)).astype(np.int8)
            mask = ((coarse_truth >= coarse_threshold) & (validity == 1)).astype(np.int8)
            mask.attrs = {"units": "1", "definition": "CHIRPS daily precipitation >= local monthly 95th percentile"}
            validity.attrs = {"units": "1", "definition": "CHIRPS-covered land cell"}
            _write_field(_with_valid_time(forecast_mean, valid, "precipitation"), forecast_path)
            _write_field(_with_valid_time(observation, valid, "precipitation"), observation_path)
            _write_field(_with_valid_time(efi, valid, "efi"), efi_path)
            _write_field(_with_valid_time(gust, valid, "wind_gust"), gust_path)
            _write_field(_with_valid_time(pressure, valid, "pressure_msl"), pressure_path)
            _write_field(_with_valid_time(mask, valid, "extreme_mask"), mask_path)
            _write_field(_with_valid_time(validity, valid, "valid_mask"), validity_path)
        valid_text = valid.isoformat().replace("+00:00", "Z")
        training.append(
            {
                "event_id": event_id,
                "forecast": forecast_path.as_posix(),
                "observation": observation_path.as_posix(),
                "forecast_variable": "precipitation",
                "observation_variable": "precipitation",
                "lead_hours": lead,
                "accumulation_hours": 24,
                "valid_time": valid_text,
                "bounds": bounds,
            }
        )
        tracking.append(
            {
                "event_id": event_id,
                "lead_hours": lead,
                "valid_time": valid_text,
                "bounds": bounds,
                "baseline_threshold": 0.5,
                "fields": [
                    {"path": efi_path.as_posix(), "variable": "efi"},
                    {"path": gust_path.as_posix(), "variable": "wind_gust"},
                    {"path": pressure_path.as_posix(), "variable": "pressure_msl"},
                ],
                "mask": {"path": mask_path.as_posix(), "variable": "extreme_mask"},
                "valid_mask": {"path": validity_path.as_posix(), "variable": "valid_mask"},
            }
        )
    training_path = root / "training-catalog.json"
    tracking_path = root / "tracking-catalog.json"
    training_path.write_text(json.dumps({"samples": training}, indent=2), encoding="utf-8")
    tracking_path.write_text(json.dumps({"samples": tracking}, indent=2), encoding="utf-8")
    return training_path, tracking_path


def latest_operational_run(now: datetime | None = None) -> datetime:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    for day_offset in range(3):
        day = now.date() - timedelta(days=day_offset)
        for cycle in (18, 12, 6, 0):
            candidate = datetime(day.year, day.month, day.day, cycle, tzinfo=timezone.utc)
            if candidate > now - timedelta(hours=5):
                continue
            try:
                request_bytes(operational_url(candidate, "c00", 96) + ".idx")
                return candidate
            except HTTPError as error:
                if error.code != 404:
                    raise
    raise RuntimeError("No complete operational GEFS cycle found in the previous three days")


def _operational_member_field(
    initialization: datetime,
    member: str,
    lead: int,
    variable: str,
    bounds: list[float],
    scratch: Path,
) -> xr.DataArray:
    if variable == "precipitation":
        parts = []
        for part_lead in range(lead - 18, lead + 1, 6):
            url = operational_url(initialization, member, part_lead)
            records = parse_index(request_text(url + ".idx"))
            chosen = [record for record in records if f":APCP:surface:{part_lead - 6}-{part_lead} hour acc fcst:" in record.description]
            if len(chosen) != 1:
                raise ValueError(f"Expected one APCP interval at operational lead {part_lead}")
            path = scratch / f"apcp-{part_lead:03d}.grib2"
            download_records(url, chosen, path)
            parts.append(_decode_precipitation(path, bounds))
        return sum(parts[1:], parts[0])
    url = operational_url(initialization, member, lead)
    records = parse_index(request_text(url + ".idx"))
    token = "GUST" if variable == "wind_gust" else "PRMSL"
    chosen = [record for record in records if f":{token}:" in record.description]
    if len(chosen) != 1:
        raise ValueError(f"Expected one {token} field at operational lead {lead}")
    path = scratch / f"{variable}.grib2"
    download_records(url, chosen, path)
    return _decode_instant(path, bounds, "m s-1" if variable == "wind_gust" else "Pa")


def prepare_live(manifest: dict, root: Path, leads: list[int], force: bool = False) -> Path:
    initialization = latest_operational_run()
    bounds = manifest["bounds"]
    runs, tracking_runs = [], []
    for lead in leads:
        if lead < 72 or lead > 240 or lead % 6:
            raise ValueError("Live leads must be six-hour increments from 72 to 240")
        valid = initialization + timedelta(hours=lead)
        print(f"[live {initialization:%Y%m%d%H}] f{lead:03d}", flush=True)
        run_dir = root / "live" / initialization.strftime("%Y%m%d%H") / f"f{lead:03d}"
        precip_path = run_dir / "forecast-precipitation.nc"
        efi_path = run_dir / "forecast-efi.nc"
        gust_path = run_dir / "forecast-wind-gust.nc"
        pressure_path = run_dir / "forecast-pressure-msl.nc"
        if force or not all(path.exists() for path in (precip_path, efi_path, gust_path, pressure_path)):
            values: dict[str, list[xr.DataArray]] = {name: [] for name in ("precipitation", "wind_gust", "pressure_msl")}
            with tempfile.TemporaryDirectory(prefix="reyva-live-") as directory:
                for member in MEMBERS:
                    for variable in values:
                        values[variable].append(
                            _operational_member_field(
                                initialization, member, lead, variable, bounds, Path(directory) / member / variable
                            )
                        )
            precipitation = xr.concat(values["precipitation"], dim="number")
            gust = xr.concat(values["wind_gust"], dim="number").mean("number")
            pressure = xr.concat(values["pressure_msl"], dim="number").mean("number")
            climate_path = root / "climatology" / f"month-{valid.month:02d}.nc"
            if not climate_path.exists():
                raise RuntimeError(f"Missing month {valid.month} climatology for live EFI")
            with xr.open_dataset(climate_path) as climate:
                quantiles = climate["model_precipitation_quantiles"].load()
            efi = xr.DataArray(
                extreme_forecast_index(precipitation.values, quantiles.values, QUANTILES),
                dims=("lat", "lon"), coords={"lat": precipitation.lat, "lon": precipitation.lon},
                attrs={"units": "1"},
            )
            _write_field(_with_valid_time(precipitation.mean("number"), valid, "precipitation"), precip_path)
            _write_field(_with_valid_time(efi, valid, "efi"), efi_path)
            _write_field(_with_valid_time(gust, valid, "wind_gust"), gust_path)
            _write_field(_with_valid_time(pressure, valid, "pressure_msl"), pressure_path)
        valid_text = valid.isoformat().replace("+00:00", "Z")
        runs.append(
            {
                "event_id": "LIVE-RAIN",
                "hour": lead,
                "forecast": precip_path.as_posix(),
                "variable": "precipitation",
                "accumulation_hours": 24,
                "valid_time": valid_text,
                "bounds": bounds,
                "source": f"NOAA GEFS 0.25 degree, five-member mean, {initialization:%Y-%m-%d %HZ}",
            }
        )
        tracking_runs.append(
            {
                "event_id": "LIVE-RAIN",
                "hour": lead,
                "valid_time": valid_text,
                "bounds": bounds,
                "fields": [
                    {"path": efi_path.as_posix(), "variable": "efi"},
                    {"path": gust_path.as_posix(), "variable": "wind_gust"},
                    {"path": pressure_path.as_posix(), "variable": "pressure_msl"},
                ],
            }
        )
    catalog = root / "live-catalog.json"
    catalog.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "initialization": initialization.isoformat(),
                "runs": runs,
                "tracking_runs": tracking_runs,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return catalog


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "prepare-climatology", "prepare-events", "prepare-live", "prepare-all"))
    parser.add_argument("--manifest", type=Path, default=Path("ml_service/public-manifest.json"))
    parser.add_argument("--output", type=Path, default=Path("ml_service/data/public"))
    parser.add_argument("--leads", default="72,96,120,144,168,192,216,240")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    manifest = load_manifest(args.manifest)
    if args.command == "plan":
        print(json.dumps(plan(manifest), indent=2))
        return
    args.output.mkdir(parents=True, exist_ok=True)
    metadata = {
        **plan(manifest),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "noaa_gefs_reforecast": REFORECAST_ROOT,
            "noaa_gefs_operational": OPERATIONAL_ROOT,
            "chirps_v3_rnl": CHIRPS_ROOT,
        },
        "manifest": str(args.manifest),
    }
    (args.output / "pipeline-metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    if args.command in {"prepare-climatology", "prepare-all"}:
        prepare_climatology(manifest, args.output, args.force)
    if args.command in {"prepare-events", "prepare-all"}:
        training, tracking = prepare_events(manifest, args.output, args.force)
        print(f"Training catalog: {training}\nTracking catalog: {tracking}")
    if args.command in {"prepare-live", "prepare-all"}:
        leads = [int(value) for value in args.leads.split(",") if value.strip()]
        print(f"Live catalog: {prepare_live(manifest, args.output, leads, args.force)}")


if __name__ == "__main__":
    main()
