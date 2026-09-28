"""Trainable interfaces. Real prediction requires calibrated weights and validation."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ModelArtifacts:
    graph_weights: Path
    diffusion_weights: Path
    validation_report: Path

    def verify(self) -> None:
        missing = [str(path) for path in (self.graph_weights, self.diffusion_weights, self.validation_report) if not path.is_file()]
        if missing:
            raise RuntimeError("Model artifacts missing: " + ", ".join(missing))


def graph_data(nodes, edge_index):
    """Adapt meteorological grid samples to a PyTorch Geometric graph."""
    import torch
    from torch_geometric.data import Data

    if len(nodes) == 0:
        raise ValueError("Graph must contain at least one weather cell")
    x = torch.as_tensor(nodes, dtype=torch.float32)
    edges = torch.as_tensor(edge_index, dtype=torch.long)
    if edges.ndim != 2 or edges.shape[0] != 2:
        raise ValueError("edge_index must have shape [2, number_of_edges]")
    return Data(x=x, edge_index=edges)


def inference_unavailable() -> None:
    raise RuntimeError("Inference disabled: trained weights, input provenance, and a validation report are required")
