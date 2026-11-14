"""Screenshots of the live site for docs/slides/img/ (headless Chromium, nothing opens on screen).
Run: python frontend/scripts/slide_shots.py [site_url]   (needs: pip install playwright; playwright install chromium)
"""
import os, sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://evge14n.github.io/spaceu-lunar-navigator/"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "slides", "img")
SHOTS = {  # name: (hash route, wait seconds)
    "map": ("#/map", 1.5),
    "compare": ("#/compare", 1.5),
    "timeline": ("#/timeline", 1.5),
    "view3d": ("#/3d", 6),
    "why": ("#/why", 1.5),
}

os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=2)
    for name, (route, wait) in SHOTS.items():
        pg.goto(URL + route, wait_until="networkidle")
        time.sleep(wait)
        target = pg.locator("main")
        if name == "view3d":
            target = pg.locator(".stage")
        target.screenshot(path=os.path.join(OUT, f"{name}.png"))
        print("saved", name)
    b.close()
