import unittest

from ml_service.validation import approve_downscaler, approve_tracker, split_events
from ml_service.validation import partition_events

try:
    import numpy as np

    from ml_service.efi import extreme_forecast_index
except ImportError:
    np = None


class ValidationTests(unittest.TestCase):
    def test_training_only_events_do_not_enter_held_out_splits(self):
        records = [{"event_id": f"event-{index}"} for index in range(12)] + [
            {"event_id": f"climate-{index}", "split": "train"} for index in range(4)
        ]
        training, validation, test = partition_events(records)
        self.assertTrue({f"climate-{index}" for index in range(4)} <= training)
        self.assertFalse(any(event.startswith("climate-") for event in validation | test))

    def test_event_groups_do_not_overlap(self):
        training, validation, test = split_events(
            [{"event_id": f"event-{index}"} for index in range(12)]
        )
        self.assertFalse(training & validation)
        self.assertFalse(training & test)
        self.assertFalse(validation & test)
        self.assertEqual(len(training | validation | test), 12)

    def test_downscaler_must_improve_holdout_and_extreme_values(self):
        good = {
            "baseline_mae_mm": 10,
            "model_mae_mm": 8,
            "baseline_rmse_mm": 15,
            "model_rmse_mm": 12,
            "baseline_p99_error_mm": 20,
            "model_p99_error_mm": 15,
            "cases": 3,
        }
        self.assertTrue(approve_downscaler(good, good))
        weak = {**good, "model_p99_error_mm": 25}
        self.assertFalse(approve_downscaler(good, weak))
        self.assertFalse(approve_downscaler(good, {**good, "cases": 1}))

    def test_tracker_must_beat_declared_baseline(self):
        good = {"f1": 0.7, "threshold_baseline_f1": 0.5, "cases": 3}
        self.assertTrue(approve_tracker(good, good))
        self.assertFalse(approve_tracker(good, {**good, "f1": 0.52}))

    def test_efi_sign_tracks_forecast_extremes(self):
        if np is None:
            self.skipTest("weather dependencies are not installed")
        probabilities = np.linspace(0.05, 0.95, 19)
        climate = np.broadcast_to(probabilities[:, None, None], (19, 2, 2))
        high = np.ones((31, 2, 2)) * 2
        low = np.ones((31, 2, 2)) * -1
        self.assertTrue((extreme_forecast_index(high, climate, probabilities) > 0.8).all())
        self.assertTrue((extreme_forecast_index(low, climate, probabilities) < -0.8).all())


if __name__ == "__main__":
    unittest.main()
