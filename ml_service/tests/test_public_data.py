import unittest
from datetime import datetime, timezone
from http.client import RemoteDisconnected
from unittest.mock import patch

import numpy as np
import xarray as xr

from ml_service.public_data import (
    chirps_url,
    _model_quantiles_on,
    operational_url,
    parse_index,
    plan,
    reforecast_url,
    request_bytes,
    select_accumulation,
    select_instant,
)


INDEX = """1:0:d=2019050100:APCP:surface:66-72 hour acc fcst:ENS=low-res ctl
2:50:d=2019050100:APCP:surface:72-75 hour acc fcst:ENS=low-res ctl
3:100:d=2019050100:APCP:surface:72-78 hour acc fcst:ENS=low-res ctl
4:150:d=2019050100:APCP:surface:78-81 hour acc fcst:ENS=low-res ctl
5:200:d=2019050100:APCP:surface:78-84 hour acc fcst:ENS=low-res ctl
6:300:d=2019050100:APCP:surface:84-90 hour acc fcst:ENS=low-res ctl
7:400:d=2019050100:APCP:surface:90-96 hour acc fcst:ENS=low-res ctl
8:500:d=2019050100:GUST:surface:96 hour fcst:ENS=low-res ctl
9:600:d=2019050100:PRES:mean sea level:96 hour fcst:ENS=low-res ctl
10:700:d=2019050100:TMP:2 m above ground:96 hour fcst:ENS=low-res ctl
"""


class PublicDataTests(unittest.TestCase):
    def test_network_disconnect_is_retried(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b"recovered"

        with (
            patch(
                "ml_service.public_data.urlopen",
                side_effect=[RemoteDisconnected("closed"), Response()],
            ) as opener,
            patch("ml_service.public_data.time.sleep") as sleep,
        ):
            self.assertEqual(request_bytes("https://example.test/data"), b"recovered")
        self.assertEqual(opener.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_index_selection_requires_contiguous_24_hours(self):
        records = parse_index(INDEX)
        selected = select_accumulation(records, 72, 96)
        self.assertEqual([record.offset for record in selected], [100, 200, 300, 400])
        self.assertEqual(selected[-1].end, 499)
        self.assertEqual(select_instant(records, "GUST", 96).offset, 500)
        with self.assertRaisesRegex(ValueError, "complete"):
            select_accumulation(records, 73, 96)

    def test_official_urls_match_documented_layouts(self):
        initialization = datetime(2019, 5, 1, tzinfo=timezone.utc)
        self.assertIn("2019/2019050100/c00/Days%3A1-10/apcp_sfc_2019050100_c00.grib2", reforecast_url(initialization, "c00", "apcp_sfc"))
        self.assertTrue(operational_url(initialization, "p04", 96).endswith("gep04.t00z.pgrb2s.0p25.f096"))
        self.assertTrue(chirps_url(initialization).endswith("2019/chirps-v3.0.rnl.2019.05.01.cog"))

    def test_plan_reports_event_and_climatology_counts(self):
        manifest = {
            "bounds": [68, 6, 98, 36],
            "climatology_start_year": 2000,
            "climatology_days": [5, 15, 25],
            "events": [
                {"event_id": f"event-{index}", "initialization": "2019-04-29T00:00:00Z", "lead_hours": 96}
                for index in range(10)
            ],
        }
        result = plan(manifest)
        self.assertEqual(result["events"], 10)
        self.assertEqual(result["climatology_cases"], 60)

    def test_plan_rejects_missing_event_valid_month(self):
        manifest = {
            "bounds": [68, 6, 98, 36],
            "climatology_start_year": 2000,
            "climatology_months": [4],
            "climatology_days": [5, 15, 25],
            "events": [
                {"event_id": f"event-{index}", "initialization": "2019-04-29T00:00:00Z", "lead_hours": 96}
                for index in range(10)
            ],
        }
        with self.assertRaisesRegex(ValueError, "valid-time months"):
            plan(manifest)

    def test_legacy_union_climate_grid_is_restored(self):
        values = np.full((19, 3, 3), np.nan, dtype=np.float32)
        values[:, (0, 2), :] = 1
        values[:, :, 1] = np.nan
        legacy = xr.DataArray(
            values,
            dims=("quantile", "lat", "lon"),
            coords={"quantile": np.linspace(0.05, 0.95, 19), "lat": [0, 0.5, 1], "lon": [0, 0.5, 1]},
        )
        target = xr.DataArray(
            np.zeros((2, 2), dtype=np.float32),
            dims=("lat", "lon"),
            coords={"lat": [0, 1], "lon": [0, 1]},
        )
        aligned = _model_quantiles_on(legacy, target)
        self.assertEqual(aligned.shape, (19, 2, 2))
        self.assertTrue(np.isfinite(aligned).all())


if __name__ == "__main__":
    unittest.main()
