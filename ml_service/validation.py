"""Release gates shared by both trainers; no ML runtime dependency."""

import math
import random


def split_events(samples: list[dict]):
    events = sorted({sample["event_id"] for sample in samples})
    if len(events) < 10:
        raise ValueError("At least ten distinct historical events are required for event-held-out evaluation")
    random.Random(42).shuffle(events)
    test = set(events[: max(2, len(events) // 5)])
    validation = set(events[len(test) : len(test) + max(2, len(events) // 5)])
    train = set(events) - test - validation
    return train, validation, test


def partition_events(records: list[dict]):
    evaluation = [record for record in records if record.get("split") != "train"]
    train_ids, validation_ids, test_ids = split_events(evaluation)
    forced_train = {record["event_id"] for record in records if record.get("split") == "train"}
    if forced_train & (validation_ids | test_ids):
        raise ValueError("Training-only events overlap held-out events")
    return train_ids | forced_train, validation_ids, test_ids


def approve_downscaler(validation: dict, test: dict):
    for group in (validation, test):
        values = [
            group.get("baseline_mae_mm", float("nan")),
            group.get("model_mae_mm", float("nan")),
            group.get("baseline_rmse_mm", float("nan")),
            group.get("model_rmse_mm", float("nan")),
            group.get("baseline_p99_error_mm", float("nan")),
            group.get("model_p99_error_mm", float("nan")),
        ]
        if (
            group.get("cases", 0) < 2
            or not all(math.isfinite(value) and value >= 0 for value in values)
            or group["baseline_mae_mm"] == 0
        ):
            return False
        if not (
            group["model_mae_mm"] <= 0.95 * group["baseline_mae_mm"]
            and group["model_rmse_mm"] <= group["baseline_rmse_mm"]
        ):
            return False
    return (
        test["baseline_p99_error_mm"] > 0
        and test["model_p99_error_mm"] <= 0.95 * test["baseline_p99_error_mm"]
    )


def approve_tracker(validation: dict, test: dict):
    for group in (validation, test):
        score = group.get("f1", float("nan"))
        baseline = group.get("threshold_baseline_f1", float("nan"))
        if (
            group.get("cases", 0) < 2
            or not math.isfinite(score)
            or not math.isfinite(baseline)
            or score < 0.5
            or score < baseline + 0.05
        ):
            return False
    return True
