"""Strict ingestion of paired gridded forecasts and observations."""

from pathlib import Path

import numpy as np
import xarray as xr
from metpy.units import units


def open_field(
    path: str,
    variable: str,
    bounds: tuple[float, float, float, float] | list[float] | None = None,
) -> xr.DataArray:
    source = Path(path).resolve(strict=True)
    if source.suffix.lower() not in {".nc", ".nc4", ".grib", ".grib2", ".grb2"}:
        raise ValueError("Input must be NetCDF or GRIB2")
    engine = "cfgrib" if source.suffix.lower() in {".grib", ".grib2", ".grb2"} else None
    with xr.open_dataset(source, engine=engine, chunks="auto") as dataset:
        if variable not in dataset:
            raise ValueError(f"Variable {variable!r} is absent from {source.name}")
        field = dataset[variable]
        for dimension in ("time", "step", "valid_time"):
            if dimension in field.dims:
                if field.sizes[dimension] != 1:
                    raise ValueError(f"Select one {dimension} slice before ingestion")
                field = field.isel({dimension: 0})
        latitude = "latitude" if "latitude" in field.coords else "lat"
        longitude = "longitude" if "longitude" in field.coords else "lon"
        if field.ndim != 2 or set(field.dims) != {latitude, longitude}:
            raise ValueError("Expected one rectilinear latitude/longitude grid")
        field = field.rename({latitude: "lat", longitude: "lon"}).transpose("lat", "lon")
        field = field.sortby("lat").sortby("lon")
        if bounds is not None:
            if len(bounds) != 4:
                raise ValueError("Bounds must be west, south, east, north")
            west, south, east, north = map(float, bounds)
            if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                raise ValueError("Invalid geographic bounds")
            field = field.sel(lat=slice(south, north), lon=slice(west, east))
            if not field.sizes.get("lat") or not field.sizes.get("lon"):
                raise ValueError("Bounds do not overlap the source grid")
        field = field.load()
        return field


def precipitation_mm(field: xr.DataArray, allow_missing: bool = False) -> xr.DataArray:
    unit = str(field.attrs.get("units", "")).strip()
    if unit in {"mm", "kg m-2", "kg/m^2", "kg m**-2"}:
        factor = 1.0
    elif unit in {"m", "meter", "metre"}:
        factor = float((1 * units.meter).to(units.millimeter).magnitude)
    else:
        raise ValueError(f"Unsupported precipitation unit {unit!r}; provide accumulated depth")
    values = np.asarray(field.values, dtype=np.float32) * factor
    finite = np.isfinite(values)
    if (not allow_missing and not finite.all()) or (values[finite] < 0).any():
        raise ValueError("Precipitation contains missing, infinite or negative values")
    return xr.DataArray(values, coords=field.coords, dims=field.dims, attrs={"units": "mm"})


def valid_time(field: xr.DataArray):
    for name in ("valid_time", "time"):
        if name in field.coords:
            value = np.asarray(field.coords[name].values).astype("datetime64[s]")
            if value.size != 1:
                raise ValueError("Expected one valid time per grid")
            return value.reshape(())[()]
    raise ValueError("Both files must contain an explicit valid_time or time coordinate")


def paired_grids(
    input_path: str,
    target_path: str,
    input_variable: str,
    target_variable: str,
    expected_valid_time: str,
    bounds: tuple[float, float, float, float] | list[float] | None = None,
    return_mask: bool = False,
):
    coarse = precipitation_mm(open_field(input_path, input_variable, bounds))
    target = precipitation_mm(open_field(target_path, target_variable, bounds), allow_missing=True)
    expected = np.datetime64(expected_valid_time.replace("Z", ""), "s")
    if valid_time(coarse) != expected or valid_time(target) != expected:
        raise ValueError("Forecast and reference valid times must match the catalog")
    if min(target.sizes["lat"], target.sizes["lon"]) < 32:
        raise ValueError("Reference grid is too small for model evaluation")
    input_spacing = max(float(np.median(np.diff(coarse.lat))), float(np.median(np.diff(coarse.lon))))
    target_spacing = max(float(np.median(np.diff(target.lat))), float(np.median(np.diff(target.lon))))
    if not (0.035 <= target_spacing <= 0.055 and input_spacing > target_spacing * 1.5):
        raise ValueError("Expected a coarse input and a roughly 0.05-degree reference grid")
    if not (
        float(coarse.lat.min()) <= float(target.lat.min())
        and float(coarse.lat.max()) >= float(target.lat.max())
        and float(coarse.lon.min()) <= float(target.lon.min())
        and float(coarse.lon.max()) >= float(target.lon.max())
    ):
        raise ValueError("Reference grid extends outside coarse forecast coverage")
    baseline = coarse.interp(lat=target.lat, lon=target.lon, method="linear")
    if not np.isfinite(baseline.values).all():
        raise ValueError("Interpolation created missing values")
    mask = np.isfinite(target.values)
    if mask.mean() < 0.1:
        raise ValueError("Reference grid has less than 10% valid observed coverage")
    truth = np.where(mask, target.values, baseline.values)
    result = (
        np.asarray(baseline.values, dtype=np.float32),
        np.asarray(truth, dtype=np.float32),
        target,
    )
    return (*result, mask) if return_mask else result
