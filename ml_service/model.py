"""Conditional DDPM for rainfall downscaling; training is required before inference."""

import torch
from diffusers import DDPMScheduler, UNet2DModel


LOG_SCALE = 5.0
RESIDUAL_LIMIT = 2.0


def create_model():
    return UNet2DModel(
        sample_size=64,
        in_channels=2,
        out_channels=1,
        layers_per_block=1,
        block_out_channels=(32, 64, 64),
        down_block_types=("DownBlock2D", "DownBlock2D", "DownBlock2D"),
        up_block_types=("UpBlock2D", "UpBlock2D", "UpBlock2D"),
    )


def create_scheduler():
    return DDPMScheduler(
        num_train_timesteps=100,
        beta_schedule="squaredcos_cap_v2",
        clip_sample=True,
        clip_sample_range=1.0,
    )


@torch.no_grad()
def generate(
    model,
    scheduler,
    coarse_mm: torch.Tensor,
    seed: int = 0,
    max_mm: float = 1000,
    residual_weight: float = 1.0,
    return_residual: bool = False,
) -> torch.Tensor:
    if coarse_mm.ndim != 4 or coarse_mm.shape[1] != 1:
        raise ValueError("Expected [batch, 1, height, width] rainfall tensor")
    if coarse_mm.shape[-2] % 8 or coarse_mm.shape[-1] % 8:
        raise ValueError("Grid dimensions must be divisible by eight")
    if not 0 <= residual_weight <= 1:
        raise ValueError("Residual weight must be between zero and one")
    coarse_log = torch.log1p(coarse_mm.clamp_min(0))
    condition = coarse_log / LOG_SCALE
    generator = torch.Generator(device=coarse_mm.device).manual_seed(seed)
    sample = torch.randn(condition.shape, generator=generator, device=coarse_mm.device)
    scheduler.set_timesteps(50, device=coarse_mm.device)
    model.eval()
    for step in scheduler.timesteps:
        residual = model(torch.cat((sample, condition), dim=1), step).sample
        sample = scheduler.step(residual, step, sample, generator=generator).prev_sample
    if return_residual:
        return sample.clamp(-1, 1) * RESIDUAL_LIMIT
    maximum = torch.log1p(torch.tensor(max_mm, device=sample.device, dtype=sample.dtype))
    corrected_log = coarse_log + residual_weight * sample.clamp(-1, 1) * RESIDUAL_LIMIT
    return torch.expm1(corrected_log.clamp(0, maximum)).clamp(0, max_mm)
