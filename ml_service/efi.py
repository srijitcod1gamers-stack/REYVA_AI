"""Extreme Forecast Index features from an ensemble and a model-climate CDF."""

import argparse
from pathlib import Path

import numpy as np
import xarray as xr


def extreme_forecast_index(
    ensemble: np.ndarray,
    climate_quantiles: np.ndarray,
    probabilities: np.ndarray,
) -> np.ndarray:
    """Return EFI on [-1, 1]; arrays are member×y×x and quantile×y×x."""
    ensemble = np.asarray(ensemble, dtype=np.float64)
    climate_quantiles = np.asarray(climate_quantiles, dtype=np.float64)
    probabilities = np.asarray(probabilities, dtype=np.float64)
    if ensemble.ndim != 3 or climate_quantiles.ndim != 3:
        raise ValueError("Expected member×lat×lon and quantile×lat×lon arrays")
    if ensemble.shape[1:] != climate_quantiles.shape[1:] or len(probabilities) != len(climate_quantiles):
        raise ValueError("Ensemble and climate grids or quantiles do not align")
    if (
        len(probabilities) < 9
        or not np.all(np.diff(probabilities) > 0)
        or probabilities[0] <= 0
        or probabilities[-1] >= 1
    ):
        raise ValueError("Use at least nine strictly increasing interior quantiles")
    if not np.isfinite(ensemble).all() or not np.isfinite(climate_quantiles).all():
        raise ValueError("EFI inputs contain missing values")
    if (np.diff(climate_quantiles, axis=0) < 0).any():
        raise ValueError("Climate quantile values must be non-decreasing")
    forecast_cdf = (ensemble[None, ...] <= climate_quantiles[:, None, ...]).mean(axis=1)
    nodes, quadrature_weights = np.polynomial.legendre.leggauss(64)
    theta = (nodes + 1) * np.pi / 4
    theta_weights = quadrature_weights * np.pi / 4
    integration_probabilities = np.sin(theta) ** 2
    upper = np.searchsorted(probabilities, integration_probabilities, side="right")
    upper = np.clip(upper, 1, len(probabilities) - 1)
    lower = upper - 1
    spans = probabilities[upper] - probabilities[lower]
    fractions = (integration_probabilities - probabilities[lower]) / spans
    fractions = np.clip(fractions, 0, 1)[:, None, None]
    interpolated_cdf = forecast_cdf[lower] * (1 - fractions) + forecast_cdf[upper] * fractions
    values = (4 / np.pi) * np.sum(
        (integration_probabilities[:, None, None] - interpolated_cdf)
        * theta_weights[:, None, None],
        axis=0,
    )
    return np.clip(values, -1, 1).astype(np.float32)


def _open(path: Path):
    engine = "cfgrib" if path.suffix.lower() in {".grib", ".grib2", ".grb2"} else None
    return xr.open_dataset(path, engine=engine, chunks="auto")


def build_efi(
    forecast_path: Path,
    forecast_variable: str,
    climate_path: Path,
    climate_variable: str,
    output: Path,
    member_dimension: str,
    quantile_dimension: str,
):
    with _open(forecast_path) as forecast_data, _open(climate_path) as climate_data:
        forecast = forecast_data[forecast_variable]
        climate = climate_data[climate_variable]
        for dimension in ("time", "step", "valid_time"):
            if dimension in forecast.dims:
                if forecast.sizes[dimension] != 1:
                    raise ValueError(f"Select one {dimension} before building EFI")
                forecast = forecast.isel({dimension: 0})
        forecast_time = None
        for name in ("valid_time", "time"):
            if name in forecast.coords:
                value = np.asarray(forecast.coords[name].values).astype("datetime64[s]")
                if value.size == 1:
                    forecast_time = value.reshape(())[()]
                    break
        if forecast_time is None:
            raise ValueError("Ensemble forecast needs a valid_time or time coordinate")
        if member_dimension not in forecast.dims or quantile_dimension not in climate.dims:
            raise ValueError("Missing ensemble-member or climate-quantile dimension")
        rename = {"latitude": "lat", "longitude": "lon"}
        forecast = forecast.rename({key: value for key, value in rename.items() if key in forecast.coords})
        climate = climate.rename({key: value for key, value in rename.items() if key in climate.coords})
        forecast = forecast.transpose(member_dimension, "lat", "lon").sortby("lat").sortby("lon")
        climate = climate.transpose(quantile_dimension, "lat", "lon").sortby("lat").sortby("lon")
        if not np.array_equal(forecast.lat, climate.lat) or not np.array_equal(forecast.lon, climate.lon):
            raise ValueError("Forecast and model-climate grids must align")
        values = extreme_forecast_index(
            forecast.load().values,
            climate.load().values,
            climate[quantile_dimension].values,
        )
        field = xr.DataArray(
            values,
            dims=("lat", "lon"),
            coords={"lat": climate.lat, "lon": climate.lon, "valid_time": forecast_time},
            name="efi",
            attrs={
                "units": "1",
                "long_name": "Extreme Forecast Index",
                "method": "ECMWF Q-Qf weighted CDF integral",
            },
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        field.to_dataset().to_netcdf(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--forecast", type=Path, required=True)
    parser.add_argument("--forecast-variable", required=True)
    parser.add_argument("--climate", type=Path, required=True)
    parser.add_argument("--climate-variable", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--member-dimension", default="number")
    parser.add_argument("--quantile-dimension", default="quantile")
    arguments = parser.parse_args()
    build_efi(
        arguments.forecast,
        arguments.forecast_variable,
        arguments.climate,
        arguments.climate_variable,
        arguments.output,
        arguments.member_dimension,
        arguments.quantile_dimension,
    )
