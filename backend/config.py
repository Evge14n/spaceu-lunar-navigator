"""Paths and physical constants shared by all backend modules.

Every path can be overridden with an environment variable so the same code runs on a
developer PC, in CI and on a small cloud instance.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

BACKEND_DIR = Path(__file__).resolve().parent
# SPICE kernels (46 MB, never committed). SPICE cannot handle long or non-ASCII paths:
# if the repository lives in such a folder, point LUNAR_KERNEL_DIR to a short one.
KERNEL_DIR = Path(os.environ.get("LUNAR_KERNEL_DIR", str(BACKEND_DIR / "kernels")))
# Raw NASA rasters (1.6 GB, never committed).
RAW_DIR = Path(os.environ.get("LUNAR_RAW_DIR", str(BACKEND_DIR / "raw")))
# Precomputed static files served by GitHub Pages and by the API.
DATA_DIR = Path(os.environ.get("LUNAR_DATA_DIR", str(REPO_ROOT / "data")))

KERNELS = (
    "naif0012.tls",
    "pck00011.tpc",
    "de440s.bsp",
    "moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf",
)

MOON_RADIUS_KM = 1737.4  # reference sphere of every LOLA product
MOON_RADIUS_M = MOON_RADIUS_KM * 1000.0
SUN_RADIUS_KM = 695700.0  # IAU 2015 nominal solar radius (also used by JPL Horizons)
EARTH_RADIUS_KM = 6378.137  # equatorial radius (also used by JPL Horizons)
AU_KM = 149597870.7
SOLAR_CONSTANT_W_M2 = 1361.0  # at 1 au (NASA Moon Fact Sheet)

FRAME = "MOON_ME"  # mean Earth / polar axis frame, the frame of all LOLA maps
ABCORR = "LT+S"  # light time + stellar aberration (apparent position)
