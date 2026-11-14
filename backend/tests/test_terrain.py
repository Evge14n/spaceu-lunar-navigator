"""Projection, raster readers (axis orientation) and local terrain tiles."""

from __future__ import annotations

import numpy as np
import pyproj
import pytest

from backend import config, ephem, terrain
from backend.tests.conftest import synthetic_grid

R = config.MOON_RADIUS_M


def test_projection_formula_and_axes():
    # One degree from the pole: rho = 2 R tan(0.5 deg). Longitude 0 points to +y, 90 E to +x.
    rho = 2 * R * np.tan(np.radians(0.5))
    assert np.allclose(terrain.latlon_to_xy(-89.0, 0.0), (0.0, rho), atol=1e-6)
    assert np.allclose(terrain.latlon_to_xy(-89.0, 90.0), (rho, 0.0), atol=1e-6)
    assert np.allclose(terrain.latlon_to_xy(-89.0, 180.0), (0.0, -rho), atol=1e-6)
    assert np.allclose(terrain.latlon_to_xy(-90.0, 123.0), (0.0, 0.0), atol=1e-6)


def test_projection_matches_proj():
    """Same numbers as PROJ for the CRS written in the NASA GeoTIFFs."""
    crs = pyproj.CRS.from_proj4("+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs")
    geographic = pyproj.CRS.from_proj4("+proj=longlat +R=1737400 +no_defs")
    to_map = pyproj.Transformer.from_crs(geographic, crs, always_xy=True)
    rng = np.random.default_rng(1)
    lat = rng.uniform(-90.0, -75.0, 200)
    lon = rng.uniform(0.0, 360.0, 200)
    x_ref, y_ref = to_map.transform(lon, lat)
    x, y = terrain.latlon_to_xy(lat, lon)
    assert np.abs(x - x_ref).max() < 1e-3 and np.abs(y - y_ref).max() < 1e-3
    lat2, lon2 = terrain.xy_to_latlon(x, y)
    assert np.abs(lat2 - lat).max() < 1e-9
    assert np.abs((lon2 - lon + 180.0) % 360.0 - 180.0).max() < 1e-7


def test_unit_vector_projection():
    lat, lon = -87.3, 222.6
    u = ephem.site_vector(lat, lon, 1.0)
    assert np.allclose(terrain.unit_to_xy(u), terrain.latlon_to_xy(lat, lon), atol=1e-6)


def test_grid_bilinear_and_bounds():
    grid = synthetic_grid(lambda x, y: 0.01 * x - 0.02 * y + 5.0, half_m=1000.0, step=100.0)
    assert grid.bounds == (-1050.0, -1050.0, 1050.0, 1050.0)
    # a plane is reproduced exactly by bilinear interpolation
    assert grid.sample(123.0, -456.0) == pytest.approx(0.01 * 123 + 0.02 * 456 + 5.0, abs=1e-4)
    assert np.isnan(grid.sample(1000.1, 0.0))
    assert np.isnan(grid.sample(0.0, -1000.1))


def test_grid_missing_values_and_fallback():
    fine = synthetic_grid(lambda x, y: np.where(x > 0, np.nan, 10.0), half_m=500.0, step=50.0, name="fine")
    coarse = synthetic_grid(lambda x, y: 0 * x + 20.0, half_m=2000.0, step=100.0, name="coarse")
    surface = terrain.Surface([fine, coarse])
    got = surface.elevation_xy(np.array([-200.0, 200.0, 1500.0]), np.array([0.0, 0.0, 0.0]))
    assert got == pytest.approx([10.0, 20.0, 20.0])
    assert np.isnan(surface.elevation_xy(np.array([5000.0]), np.array([0.0]))[0])


def test_block_mean_keeps_georeferencing():
    grid = synthetic_grid(lambda x, y: 0.5 * x + 0.25 * y, half_m=1000.0, step=5.0)
    coarse = grid.block_mean(4)
    assert coarse.step == 20.0
    for x, y in [(0.0, 0.0), (333.0, -250.0), (-700.0, 640.0)]:
        assert coarse.sample(x, y) == pytest.approx(0.5 * x + 0.25 * y, abs=1e-3)


def test_local_tile_of_a_smooth_sphere_shows_curvature():
    surface = terrain.Surface([synthetic_grid(lambda x, y: 0 * x, half_m=60000.0, step=200.0)])
    heights, z0 = terrain.local_tile(surface, -89.0, 40.0, n=65, size_m=10000.0)
    assert z0 == 0.0
    axis = np.linspace(-5000.0, 5000.0, 65)
    e, n = np.meshgrid(axis, axis[::-1])
    expected = np.sqrt(R**2 - e**2 - n**2) - R  # -7.2 m at 5 km
    assert np.abs(heights - expected).max() < 1e-2
    assert heights[32, 32] == 0.0 and heights[32, 0] == pytest.approx(-(5000.0**2) / (2 * R), abs=0.01)


def test_local_tile_orientation_rows_north_columns_east():
    # At longitude 0 local north points away from the pole (+y of the map), east to +x.
    surface = terrain.Surface([synthetic_grid(lambda x, y: 0.1 * x + 0.3 * y, half_m=60000.0, step=200.0)])
    heights, z0 = terrain.local_tile(surface, -89.0, 0.0, n=33, size_m=8000.0)
    mid = 16
    assert heights[0, mid] - heights[-1, mid] == pytest.approx(0.3 * 8000.0, rel=0.01)  # row 0 = north
    assert heights[mid, -1] - heights[mid, 0] == pytest.approx(0.1 * 8000.0, rel=0.01)  # last column = east
    # the same terrain seen from longitude 180: north is now -y, east is -x
    heights, _ = terrain.local_tile(surface, -89.0, 180.0, n=33, size_m=8000.0)
    assert heights[0, mid] - heights[-1, mid] == pytest.approx(-0.3 * 8000.0, rel=0.01)
    assert heights[mid, -1] - heights[mid, 0] == pytest.approx(-0.1 * 8000.0, rel=0.01)


def test_tile_metadata_shape():
    heights = np.zeros((512, 512), dtype=np.float32)
    meta = terrain.tile_metadata("site04", -89.7, 197.0, heights, 1729.2, 10000.0)
    assert meta["step_m"] == 19.569 and meta["file"] == "terrain/site04.bin"
    assert {"site", "n", "size_m", "step_m", "center", "min_h", "max_h", "file"} <= set(meta)


# ---- raw NASA rasters -------------------------------------------------------------------


@pytest.mark.raw
@pytest.mark.parametrize("name,lines,step", [("ldem_85s_20m", 15168, 20.0), ("ldem_80s_80m", 7600, 80.0)])
def test_ldem_label_is_read(name, lines, step):
    grid = terrain.load_ldem(name)
    assert grid.data.shape == (lines, lines) and grid.step == step and grid.scale == 0.5
    half = lines * step / 2.0
    assert grid.bounds == (-half, -half, half, half)
    # the edge of the product is the latitude in its name
    lat, _ = terrain.xy_to_latlon(half, 0.0)
    assert lat == pytest.approx(-float(name.split("_")[1][:2]), abs=0.01)


@pytest.mark.raw
@pytest.mark.parametrize("site", ["Site01", "Site04", "Site23", "Shoemaker"])
def test_axis_orientation_of_the_raw_ldem(site):
    """The PDS label does not say which way the lines and samples run.

    The 5 m site models are georeferenced GeoTIFFs (independent of our reader), so the
    raw 20 m LDEM must agree with them only in the correct orientation.
    """
    ldem = terrain.load_ldem("ldem_85s_20m")
    tile = terrain.load_geotiff(terrain.site_tiff_path(site)).block_mean(4)
    rows, cols = tile.data.shape
    x, y = np.meshgrid(tile.x0 + tile.step * np.arange(cols), tile.y0 - tile.step * np.arange(rows))
    variants = {
        "as read": (x, y),
        "flip y": (x, -y),
        "flip x": (-x, y),
        "rotate 180": (-x, -y),
        "transpose": (y, x),
        "anti-transpose": (-y, -x),
        "rotate 90": (y, -x),
        "rotate 270": (-y, x),
    }
    rms = {k: float(np.sqrt(np.nanmean((ldem.sample(*v) - tile.data) ** 2))) for k, v in variants.items()}
    assert rms["as read"] < 5.0  # measured: 1.2 .. 2.4 m
    assert min(v for k, v in rms.items() if k != "as read") > 300.0  # measured: 420 .. 6300 m


@pytest.mark.raw
def test_coarser_ldems_agree_with_the_20_m_one():
    fine = terrain.load_ldem("ldem_85s_20m")
    rng = np.random.default_rng(7)
    x, y = rng.uniform(-140000.0, 140000.0, (2, 4000))
    ref = fine.sample(x, y)
    for name, limit in (("ldem_80s_80m", 25.0), ("ldem_75s_120m", 35.0)):
        diff = terrain.load_ldem(name).sample(x, y) - ref
        assert abs(np.median(diff)) < 1.0 and np.sqrt(np.mean(diff**2)) < limit


@pytest.mark.raw
def test_shackleton_is_a_deep_crater_next_to_the_pole():
    """A known feature: Shackleton (89.67 S, 129.8 E, IAU gazetteer) has a floor about 4 km below its rim."""
    surface = terrain.default_surface()
    floor = float(surface.elevation(-89.67, 129.8)[0])
    lat, lon = np.full(360, -89.67), np.full(360, 129.8)
    x0, y0 = terrain.latlon_to_xy(lat, lon)
    ang = np.radians(np.arange(360))
    rim = surface.elevation_xy(x0 + 10500.0 * np.sin(ang), y0 + 10500.0 * np.cos(ang))
    assert floor < -2500.0
    assert np.median(rim) - floor > 3000.0
