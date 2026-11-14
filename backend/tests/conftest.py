"""Shared fixtures. Tests marked `raw` need the NASA rasters (1.4 GB, not in the repository)
and are skipped when the raw data folder is absent; everything else needs only the
SPICE kernels (46 MB)."""

from __future__ import annotations

import numpy as np
import pytest

from backend import config, terrain

RAW_FILES = ("ldem_85s_20m.img", "ldem_80s_80m.img", "ldem_75s_120m.img", "AVGVISIB_85S_060M_201608.TIF")


def raw_available() -> bool:
    return all((config.RAW_DIR / name).exists() for name in RAW_FILES)


def pytest_collection_modifyitems(config, items):  # noqa: ARG001 - pytest hook signature
    if raw_available():
        return
    skip = pytest.mark.skip(
        reason="raw NASA rasters are not downloaded (python -m backend.fetch_data rasters)"
    )
    for item in items:
        if "raw" in item.keywords:
            item.add_marker(skip)


def synthetic_grid(
    func, half_m: float = 60000.0, step: float = 100.0, name: str = "synthetic"
) -> terrain.Grid:
    """A float raster in the polar stereographic projection filled with func(x, y) (metres)."""
    n = int(2 * half_m / step) + 1
    xs = -half_m + step * np.arange(n)
    ys = half_m - step * np.arange(n)
    x, y = np.meshgrid(xs, ys)
    return terrain.Grid(name, np.ascontiguousarray(func(x, y), dtype=np.float32), -half_m, half_m, step)
