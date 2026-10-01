"""Train a DGL anomaly mask model on labelled, event-separated NWP grids."""

import argparse
import hashlib
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
import xarray as xr

from .data import open_field, valid_time
from .tracking import SphericalTracker, spherical_grid_graph
from .validation import approve_tracker, split_events

_graphs = {}
def graph_on(lat, lon, device):
    key = (lat.tobytes(), lon.tobytes(), str(device))
    if key not in _graphs:
        graph = spherical_grid_graph(lat, lon)
        graph.sources = graph.sources.to(device)
        graph.targets = graph.targets.to(device)
        graph.weights = graph.weights.to(device)
        if graph.dgl_graph is not None:
            graph.dgl_graph = graph.dgl_graph.to(device)
        _graphs[key] = graph
    return _graphs[key]


def prepare(sample: dict):
    arrays = [
        open_field(item["path"], item["variable"], sample.get("bounds"))
        for item in sample["fields"]
    ]
    mask = open_field(sample["mask"]["path"], sample["mask"]["variable"], sample.get("bounds"))
    validity_spec = sample.get("valid_mask")
    validity = (
        open_field(validity_spec["path"], validity_spec["variable"], sample.get("bounds"))
        if validity_spec
        else xr.ones_like(mask)
    )
    expected = np.datetime64(str(sample["valid_time"]).replace("Z", ""), "s")
    if any(valid_time(array) != expected for array in [*arrays, mask, validity]):
        raise ValueError("Tracker fields and label mask must share valid time")
    if any(
        not np.array_equal(array.lat, mask.lat) or not np.array_equal(array.lon, mask.lon)
        for array in [*arrays, validity]
    ):
        raise ValueError("Tracker fields and label mask must share the same grid")
    if mask.size > 20_000 or len(arrays) < 2:
        raise ValueError("Use 2+ atmospheric fields and a regional grid of at most 20,000 cells")
    features = np.stack([np.asarray(array.values, dtype=np.float32) for array in arrays], axis=-1)
    labels = np.asarray(mask.values, dtype=np.float32)
    valid = np.asarray(validity.values, dtype=np.float32)
    if (
        not np.isfinite(features).all()
        or not np.isin(labels, [0, 1]).all()
        or not np.isin(valid, [0, 1]).all()
        or valid.sum() < 100
    ):
        raise ValueError("Tracker features must be finite; labels/mask must be binary with observed cells")
    return features, labels, valid.astype(bool), np.asarray(mask.lat), np.asarray(mask.lon)


def f1(predicted, truth):
    tp = np.logical_and(predicted, truth).sum()
    fp = np.logical_and(predicted, ~truth).sum()
    fn = np.logical_and(~predicted, truth).sum()
    return float(2 * tp / max(1, 2 * tp + fp + fn))


def evaluate(model, rows, means, scales, threshold, decision_threshold=0.5):
    model.eval()
    device = next(model.parameters()).device
    scores, baselines = [], []
    with torch.no_grad():
        for _, features, labels, valid, lat, lon in rows:
            graph = graph_on(lat, lon, device)
            normalized = torch.from_numpy(((features - means) / scales).reshape(-1, features.shape[-1])).to(device)
            probabilities = torch.sigmoid(model(graph, normalized)).cpu().numpy().reshape(labels.shape)
            scores.append(f1(probabilities[valid] >= decision_threshold, labels[valid] == 1))
            baselines.append(f1(features[..., 0][valid] >= threshold, labels[valid] == 1))
    return {"f1": float(np.mean(scores)), "threshold_baseline_f1": float(np.mean(baselines)), "cases": len(rows)}


def train(catalog: Path, output: Path, epochs: int):
    torch.manual_seed(42)
    records = json.loads(catalog.read_text(encoding="utf-8"))["samples"]
    if not records or not all(72 <= int(item["lead_hours"]) <= 240 for item in records):
        raise ValueError("Tracker catalog needs day 3-10 labelled samples")
    fields = [item["variable"] for item in records[0]["fields"]]
    if any([field["variable"] for field in sample["fields"]] != fields for sample in records):
        raise ValueError("All tracker examples must use the same ordered variables")
    prepared = [(sample["event_id"], *prepare(sample)) for sample in records]
    train_ids, validation_ids, test_ids = split_events(records)
    groups = [
        [row for row in prepared if row[0] in ids]
        for ids in (train_ids, validation_ids, test_ids)
    ]
    if min(len(group) for group in groups) < 2:
        raise ValueError("At least two samples are required in each event-held-out split")
    training_values = np.concatenate([row[1][row[3]] for row in groups[0]])
    training_labels = np.concatenate([row[2][row[3]] for row in groups[0]])
    positives = float(training_labels.sum())
    negatives = float(len(training_labels) - positives)
    if positives == 0 or negatives == 0:
        raise ValueError("Tracker training split needs both extreme and non-extreme cells")
    positive_weight = negatives / positives
    means = training_values.mean(axis=0)
    scales = np.maximum(training_values.std(axis=0), 1e-6)
    baseline_threshold = float(records[0]["baseline_threshold"])
    if any(float(sample["baseline_threshold"]) != baseline_threshold for sample in records):
        raise ValueError("All tracker samples must use one declared threshold baseline")
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = SphericalTracker(len(fields)).to(device)
    print(f'Training graph mask model on {device}; release requires held-out F1 >=0.5', flush=True)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
    best = -1.0
    output.mkdir(parents=True, exist_ok=True)
    rng = random.Random(42)
    for epoch in range(epochs):
        rng.shuffle(groups[0])
        model.train()
        for _, features, labels, valid, lat, lon in groups[0]:
            graph = graph_on(lat, lon, device)
            values = torch.from_numpy(((features - means) / scales).reshape(-1, len(fields))).to(device)
            truth = torch.from_numpy(labels.reshape(-1)).to(device)
            observed = torch.from_numpy(valid.reshape(-1)).to(device)
            prediction = model(graph, values)
            loss = F.binary_cross_entropy_with_logits(
                prediction[observed],
                truth[observed],
                pos_weight=torch.tensor(positive_weight, dtype=prediction.dtype, device=device),
            )
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        validation = evaluate(model, groups[1], means, scales, baseline_threshold)
        print(f"epoch {epoch + 1}: validation F1 {validation['f1']:.3f}", flush=True)
        if validation["f1"] > best:
            best = validation["f1"]
            torch.save(model.state_dict(), output / "tracker.pt")
    model.load_state_dict(torch.load(output / "tracker.pt", weights_only=True))
    threshold_candidates = [value / 20 for value in range(1, 20)]
    decision_threshold, validation = max(
        (
            (candidate, evaluate(model, groups[1], means, scales, baseline_threshold, candidate))
            for candidate in threshold_candidates
        ),
        key=lambda item: item[1]["f1"],
    )
    test = evaluate(
        model, groups[2], means, scales, baseline_threshold, decision_threshold
    )
    approved = approve_tracker(validation, test)
    report = {
        "approved": approved,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "fields": fields,
        "means": means.tolist(),
        "scales": scales.tolist(),
        "baseline_threshold": baseline_threshold,
        "decision_threshold": decision_threshold,
        "positive_weight": positive_weight,
        "validation_scope": "CHIRPS-covered land cells",
        "train_events": sorted(train_ids),
        "validation_events": sorted(validation_ids),
        "test_events": sorted(test_ids),
        "validation": validation,
        "test": test,
        "checkpoint_sha256": hashlib.sha256((output / "tracker.pt").read_bytes()).hexdigest(),
        "catalog_sha256": hashlib.sha256(catalog.read_bytes()).hexdigest(),
        "label_rule": "Observed precipitation >= local monthly p95 and >=1 mm/24h; missing land cells excluded",
    }
    (output / "tracker-validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    if not approved:
        raise RuntimeError("Held-out graph tracker did not beat the threshold baseline")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("ml_service/artifacts"))
    parser.add_argument("--epochs", type=int, default=20)
    args = parser.parse_args()
    train(args.catalog, args.output, args.epochs)
