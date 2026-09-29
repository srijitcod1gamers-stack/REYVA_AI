"""Great-circle grid graph with PyTorch message passing and optional DGL acceleration."""

from dataclasses import dataclass

import numpy as np
import torch


@dataclass
class SphericalGraph:
    sources: torch.Tensor
    targets: torch.Tensor
    weights: torch.Tensor
    nodes: int
    dgl_graph: object | None = None


class SphericalTracker(torch.nn.Module):
    def __init__(self, features: int, hidden: int = 32):
        super().__init__()
        self.first = torch.nn.Linear(features * 2, hidden)
        self.second = torch.nn.Linear(hidden * 2, hidden)
        self.output = torch.nn.Linear(hidden, 1)

    @staticmethod
    def aggregate(graph: SphericalGraph, values: torch.Tensor):
        if graph.dgl_graph is not None:
            import dgl.function as function

            dgl_graph = graph.dgl_graph.local_var()
            dgl_graph.ndata["value"] = values
            dgl_graph.edata["weight"] = graph.weights[:, None]
            dgl_graph.update_all(function.u_mul_e("value", "weight", "message"), function.sum("message", "sum"))
            dgl_graph.update_all(function.copy_e("weight", "weight_message"), function.sum("weight_message", "norm"))
            return dgl_graph.ndata["sum"] / dgl_graph.ndata["norm"].clamp_min(1e-6)
        messages = values[graph.sources] * graph.weights[:, None]
        summed = torch.zeros_like(values).index_add_(0, graph.targets, messages)
        norm = torch.zeros((graph.nodes, 1), dtype=values.dtype, device=values.device)
        norm.index_add_(0, graph.targets, graph.weights[:, None])
        return summed / norm.clamp_min(1e-6)

    def forward(self, graph: SphericalGraph, atmospheric_fields: torch.Tensor):
        neighbors = self.aggregate(graph, atmospheric_fields)
        values = torch.relu(self.first(torch.cat((atmospheric_fields, neighbors), dim=-1)))
        neighbors = self.aggregate(graph, values)
        values = torch.relu(self.second(torch.cat((values, neighbors), dim=-1)))
        return self.output(values).squeeze(-1)


def spherical_grid_graph(latitudes: np.ndarray, longitudes: np.ndarray):
    """Connect neighboring cells and weight edges by great-circle distance."""
    height, width = len(latitudes), len(longitudes)
    if height < 2 or width < 2:
        raise ValueError("At least two coordinates on each axis are required")
    source, target, weights = [], [], []
    for y in range(height):
        for x in range(width):
            for dy, dx in ((1, 0), (0, 1)):
                ny, nx = y + dy, x + dx
                if ny >= height or nx >= width:
                    continue
                a = np.radians(float(latitudes[y]))
                b = np.radians(float(latitudes[ny]))
                dlat = b - a
                dlon = np.radians(float(longitudes[nx] - longitudes[x]))
                angular = 2 * np.arcsin(
                    np.sqrt(np.sin(dlat / 2) ** 2 + np.cos(a) * np.cos(b) * np.sin(dlon / 2) ** 2)
                )
                distance_km = max(1.0, float(6371 * angular))
                first, second = y * width + x, ny * width + nx
                source.extend((first, second))
                target.extend((second, first))
                weight = 1 / (1 + distance_km / 100)
                weights.extend((weight, weight))
    sources = torch.tensor(source, dtype=torch.int64)
    targets = torch.tensor(target, dtype=torch.int64)
    edge_weights = torch.tensor(weights, dtype=torch.float32)
    try:
        import dgl

        dgl_graph = dgl.graph((sources, targets), num_nodes=height * width)
    except Exception:
        dgl_graph = None
    return SphericalGraph(sources, targets, edge_weights, height * width, dgl_graph)
