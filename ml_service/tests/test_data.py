import tempfile
import unittest
from pathlib import Path

try:
    import numpy as np
    import xarray as xr

    from ml_service.data import paired_grids
except ImportError:
    np = None


@unittest.skipIf(np is None, "weather dependencies are not installed")
class DataContractTests(unittest.TestCase):
    def write_field(self, path: Path, spacing: float, valid_time: str):
        coordinates = np.arange(0, 2 + spacing / 2, spacing, dtype=np.float32)
        values = coordinates[:, None] + coordinates[None, :]
        field = xr.DataArray(
            values.astype(np.float32),
            dims=("latitude", "longitude"),
            coords={
                "latitude": coordinates,
                "longitude": coordinates,
                "valid_time": np.datetime64(valid_time),
            },
            attrs={"units": "mm"},
            name="rain",
        )
        field.to_dataset().to_netcdf(path)

    def test_paired_grids_enforce_resolution_and_time(self):
        with tempfile.TemporaryDirectory() as directory:
            coarse = Path(directory) / "coarse.nc"
            target = Path(directory) / "target.nc"
            self.write_field(coarse, 0.25, "2020-05-20T00:00:00")
            self.write_field(target, 0.05, "2020-05-20T00:00:00")
            baseline, truth, coordinates = paired_grids(
                str(coarse), str(target), "rain", "rain", "2020-05-20T00:00:00Z", [0, 0, 2, 2]
            )
            self.assertEqual(baseline.shape, truth.shape)
            self.assertEqual(baseline.shape, (41, 41))
            self.assertEqual(coordinates.attrs["units"], "mm")

            with xr.open_dataset(target) as dataset:
                masked = dataset.load()
            masked["rain"].values[:8, :8] = np.nan
            masked.to_netcdf(target, mode="w")
            _, truth, _, valid = paired_grids(
                str(coarse),
                str(target),
                "rain",
                "rain",
                "2020-05-20T00:00:00Z",
                [0, 0, 2, 2],
                return_mask=True,
            )
            self.assertFalse(valid[:8, :8].any())
            self.assertTrue(np.isfinite(truth).all())

            with self.assertRaisesRegex(ValueError, "valid times"):
                paired_grids(
                    str(coarse), str(target), "rain", "rain", "2020-05-21T00:00:00Z", [0, 0, 2, 2]
                )


if __name__ == "__main__":
    unittest.main()
