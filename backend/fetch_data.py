"""Download the NASA inputs (official addresses only).

    python -m backend.fetch_data kernels     # 46 MB of SPICE kernels (needed by everything)
    python -m backend.fetch_data rasters     # 1.3 GB of LOLA rasters (needed only to recompute data/)

Files that already exist with the expected size are skipped.
"""

from __future__ import annotations

import sys
from pathlib import Path

import requests

from . import config

NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
PDS = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/"
PGDA_ILL = "https://pgda.gsfc.nasa.gov/data/MoonIllumination/"
PGDA_5M = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/"

KERNEL_URLS = {
    "naif0012.tls": NAIF + "lsk/naif0012.tls",
    "pck00011.tpc": NAIF + "pck/pck00011.tpc",
    "de440s.bsp": NAIF + "spk/planets/de440s.bsp",
    "moon_pa_de440_200625.bpc": NAIF + "pck/moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf": NAIF + "fk/satellites/moon_de440_250416.tf",
}

SITE_DIRS = [
    "Site01",
    "Site04",
    "Site06",
    "Site07",
    "Site11",
    "Site20",
    "Site23",
    "Haworth",
    "Shoemaker",
    "DM2",
]

RASTER_URLS = {
    "ldem_85s_20m.img": PDS + "ldem_85s_20m.img",
    "ldem_85s_20m.lbl": PDS + "ldem_85s_20m.lbl",
    "ldem_80s_80m.img": PDS + "ldem_80s_80m.img",
    "ldem_80s_80m.lbl": PDS + "ldem_80s_80m.lbl",
    "AVGVISIB_85S_060M_201608.TIF": PGDA_ILL + "AVGVISIB_85S_060M_201608.TIF",
    "AVGVISIB_85S_060M_201608_EARTH.TIF": PGDA_ILL + "AVGVISIB_85S_060M_201608_EARTH.TIF",
    "LPSR_85S_060M_201608.TIF": PGDA_ILL + "LPSR_85S_060M_201608.TIF",
    "README_LOLA_5mpp.txt": PGDA_5M + "README",
    **{f"sites/{s}_final_adj_5mpp_surf.tif": f"{PGDA_5M}{s}/{s}_final_adj_5mpp_surf.tif" for s in SITE_DIRS},
}


def download(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=120) as resp:
        resp.raise_for_status()
        size = int(resp.headers.get("Content-Length", -1))
        if target.exists() and target.stat().st_size == size:
            print(f"ok       {target.name}")
            return
        tmp = target.with_suffix(target.suffix + ".part")
        with open(tmp, "wb") as fh:
            for chunk in resp.iter_content(1 << 20):
                fh.write(chunk)
        tmp.replace(target)
        print(f"fetched  {target.name}  {target.stat().st_size} bytes")


def main(argv: list[str]) -> int:
    what = argv[1] if len(argv) > 1 else "kernels"
    if what == "kernels":
        for name, url in KERNEL_URLS.items():
            download(url, config.KERNEL_DIR / name)
    elif what == "rasters":
        for name, url in RASTER_URLS.items():
            download(url, config.RAW_DIR / name)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
