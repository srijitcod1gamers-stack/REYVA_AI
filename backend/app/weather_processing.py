"""Scientific data interfaces. Install backend[weather,geospatial] for these functions."""
from __future__ import annotations

from pathlib import Path


def open_forecast(path: str):
    """Open NetCDF or GRIB lazily; callers must check provenance and dataset license."""
    import xarray as xr

    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(source)
    if source.suffix.lower() in {".grib", ".grb", ".grib2"}:
        import cfgrib  # noqa: F401 — registers the xarray engine
        return xr.open_dataset(source, engine="cfgrib", chunks={"time": 1})
    if source.suffix.lower() in {".nc", ".nc4"}:
        return xr.open_dataset(source, chunks={"time": 1})
    raise ValueError("Expected .grib, .grb, .grib2, .nc, or .nc4")


def precipitation_anomaly(field, climatology):
    """Dimension-aligned anomaly; actual climatology must be independently sourced."""
    import numpy as np
    aligned_field, aligned_climatology = field.align(climatology, join="exact")
    values = aligned_field - aligned_climatology
    return values.where(np.isfinite(values))


def risk_exposure(polygon, assets):
    """Intersect a hazard polygon with an authoritative GeoDataFrame of assets."""
    import geopandas as gpd
    from shapely.geometry import shape

    if not isinstance(assets, gpd.GeoDataFrame):
        raise TypeError("assets must be a GeoDataFrame")
    if assets.crs is None:
        raise ValueError("assets must have a declared coordinate system")
    target = gpd.GeoDataFrame(geometry=[shape(polygon)], crs="EPSG:4326").to_crs(assets.crs)
    return gpd.sjoin(assets, target, how="inner", predicate="intersects")


def raster_window(path: str, bounds: tuple[float, float, float, float]):
    """Read only the requested geographic window of an R2-sourced local raster."""
    import rasterio
    from rasterio.windows import from_bounds

    with rasterio.open(path) as src:
        if src.crs is None:
            raise ValueError("raster CRS missing")
        window = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
        return src.read(window=window, boundless=True, masked=True), src.window_transform(window)
