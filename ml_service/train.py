"""Train on paired forecast/observation grids; release only after event-held-out skill checks.

Run from the repository root with: python -m ml_service.train --catalog path/to/catalog.json
The catalog contains {"samples": [{"event_id": "...", "forecast": "...",
"observation": "...", "forecast_variable": "tp", "observation_variable": "precip",
"lead_hours": 96, "accumulation_hours": 24, "valid_time": "2020-05-20T00:00:00Z"}]}.
Each sample must have matching accumulation periods and valid time in its source files.
"""

import argparse
import hashlib
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from .data import paired_grids
from .model import create_model, create_scheduler, generate
from .validation import approve_downscaler, split_events


def load_samples(catalog: Path):
    records = json.loads(catalog.read_text(encoding="utf-8"))["samples"]
    if not isinstance(records, list) or not records:
        raise ValueError("Catalog has no samples")
    prepared = []
    for sample in records:
        if (
            not 72 <= int(sample["lead_hours"]) <= 240
            or not sample.get("valid_time")
            or not 1 <= int(sample["accumulation_hours"]) <= 240
        ):
            raise ValueError("Each sample needs a valid time, accumulation window and day 3-10 lead")
        baseline, truth, _ = paired_grids(
            sample["forecast"], sample["observation"],
            sample["forecast_variable"], sample["observation_variable"],
            sample["valid_time"],
            sample.get("bounds"),
        )
        if min(baseline.shape) < 64:
            raise ValueError("Each paired grid must be at least 64 by 64 cells")
        prepared.append((sample["event_id"], baseline, truth))
    return prepared, records


def patch(array: np.ndarray, y: int, x: int):
    return array[y : y + 64, x : x + 64]


def score(model, scheduler, rows, device, output_cap_mm):
    baseline_errors = []
    model_errors = []
    baseline_peaks = []
    model_peaks = []
    for index, (_, baseline, truth) in enumerate(rows):
        y = (baseline.shape[0] - 64) // 2
        x = (baseline.shape[1] - 64) // 2
        coarse = patch(baseline, y, x)
        reference = patch(truth, y, x)
        prediction = generate(
            model, scheduler,
            torch.from_numpy(coarse)[None, None].to(device), seed=index, max_mm=output_cap_mm,
        )[0, 0].cpu().numpy()
        baseline_errors.extend((coarse - reference).ravel().tolist())
        model_errors.extend((prediction - reference).ravel().tolist())
        reference_peak = float(np.percentile(reference, 99))
        baseline_peaks.append(abs(float(np.percentile(coarse, 99)) - reference_peak))
        model_peaks.append(abs(float(np.percentile(prediction, 99)) - reference_peak))
    return {
        "baseline_mae_mm": float(np.mean(np.abs(baseline_errors))),
        "model_mae_mm": float(np.mean(np.abs(model_errors))),
        "baseline_rmse_mm": float(np.sqrt(np.mean(np.square(baseline_errors)))),
        "model_rmse_mm": float(np.sqrt(np.mean(np.square(model_errors)))),
        "baseline_p99_error_mm": float(np.mean(baseline_peaks)),
        "model_p99_error_mm": float(np.mean(model_peaks)),
        "cases": len(rows),
    }


def train(catalog: Path, output: Path, epochs: int):
    torch.manual_seed(42)
    np.random.seed(42)
    rows, records = load_samples(catalog)
    windows = {int(sample["accumulation_hours"]) for sample in records}
    if len(windows) != 1:
        raise ValueError("All training examples must use the same precipitation accumulation window")
    train_ids, val_ids, test_ids = split_events(records)
    train_rows = [row for row in rows if row[0] in train_ids]
    val_rows = [row for row in rows if row[0] in val_ids]
    test_rows = [row for row in rows if row[0] in test_ids]
    if min(len(train_rows), len(val_rows), len(test_rows)) < 2:
        raise ValueError("Insufficient paired grids per split")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    output_cap_mm = max(
        1.0,
        float(np.percentile(np.concatenate([row[2].ravel() for row in train_rows]), 99.9) * 1.25),
    )
    model = create_model().to(device)
    scheduler = create_scheduler()
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4)
    best_mae = float("inf")
    output.mkdir(parents=True, exist_ok=True)
    rng = random.Random(42)
    for epoch in range(epochs):
        rng.shuffle(train_rows)
        model.train()
        for _, baseline, truth in train_rows:
            y = rng.randrange(0, baseline.shape[0] - 63)
            x = rng.randrange(0, baseline.shape[1] - 63)
            coarse = torch.from_numpy(patch(baseline, y, x))[None, None].to(device)
            target = torch.from_numpy(patch(truth, y, x))[None, None].to(device)
            normalized = torch.log1p(target) / 5
            condition = torch.log1p(coarse) / 5
            noise = torch.randn_like(normalized)
            timestep = torch.randint(0, scheduler.config.num_train_timesteps, (1,), device=device)
            noisy = scheduler.add_noise(normalized, noise, timestep)
            predicted_noise = model(torch.cat((noisy, condition), dim=1), timestep).sample
            high = (target >= torch.quantile(target, 0.95)).float()
            denoising = ((predicted_noise - noise).square() * (1 + high * 2)).mean()
            alpha = scheduler.alphas_cumprod[timestep].reshape(1, 1, 1, 1)
            estimated = (noisy - (1 - alpha).sqrt() * predicted_noise) / alpha.sqrt()
            mass = (estimated.mean() - normalized.mean()).abs()
            loss = denoising + 0.05 * mass
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        validation = score(model, scheduler, val_rows, device, output_cap_mm)
        print(f"epoch {epoch + 1}: validation MAE {validation['model_mae_mm']:.3f} mm")
        if validation["model_mae_mm"] < best_mae:
            best_mae = validation["model_mae_mm"]
            model.save_pretrained(output / "model")
    best = type(model).from_pretrained(output / "model").to(device)
    scheduler.save_pretrained(output / "scheduler")
    validation = score(best, scheduler, val_rows, device, output_cap_mm)
    test = score(best, scheduler, test_rows, device, output_cap_mm)
    approved = approve_downscaler(validation, test)
    checkpoint = output / "model" / "diffusion_pytorch_model.safetensors"
    if not checkpoint.exists():
        checkpoint = output / "model" / "diffusion_pytorch_model.bin"
    report = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "approved": approved,
        "variable": "accumulated_precipitation_mm",
        "accumulation_hours": windows.pop(),
        "resolution_degrees": 0.05,
        "output_cap_mm": output_cap_mm,
        "method": "conditional DDPM; event-held-out validation",
        "train_events": sorted(train_ids),
        "validation_events": sorted(val_ids),
        "test_events": sorted(test_ids),
        "validation": validation,
        "test": test,
        "checkpoint_sha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
        "catalog_sha256": hashlib.sha256(catalog.read_bytes()).hexdigest(),
    }
    (output / "validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    if not approved:
        raise RuntimeError("Held-out model skill did not beat bilinear interpolation; checkpoint is withheld")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("ml_service/artifacts"))
    parser.add_argument("--epochs", type=int, default=20)
    args = parser.parse_args()
    train(args.catalog, args.output, args.epochs)
