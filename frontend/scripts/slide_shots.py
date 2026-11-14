"""Screenshots of the live site for docs/slides/img/ (headless Chromium, nothing opens on screen).
Run: python frontend/scripts/slide_shots.py [site_url]   (needs: pip install playwright; playwright install chromium)
"""
import os, sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://evge14n.github.io/spaceu-lunar-navigator/"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "slides", "img")
# name: (route, css selector of the block to capture, seconds to wait, optional action)
SHOTS = {
    "map": ("#/map?site=site04", ".map-sheet .plate", 2, None),
    "card": ("#/map?site=site04", ".site-card", 2, None),
    "compare": ("#/compare?cmp=site01,site04,site06", ".panel:has(.cmp)", 2, "Darkest 30 days"),
    "mast": ("#/compare?cmp=site01,site04,site06", ".panel:has(.cmp) >> nth=1", 2, None),
    "timeline": ("#/timeline?site=site04", ".chart-panel", 2, "Darkest 30 days"),
    "horizon": ("#/horizon?site=site04", ".scene-panel", 7, None),
    "pano": ("#/horizon?site=site04", ".panel:has(.pano)", 3, None),
    "accuracy": ("#/accuracy", ".panel:has(.acc-rows)", 2, None),
    "why": ("#/why", ".why-grid", 2, None),
}

os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    for name, (route, sel, wait, action) in SHOTS.items():
        pg = b.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=2)
        pg.goto(URL + route, wait_until="networkidle")
        time.sleep(wait)
        if action:
            pg.get_by_role("button", name=action).click()
            time.sleep(1.5)
        pg.locator(sel).first.screenshot(path=os.path.join(OUT, f"{name}.png"))
        print("saved", name)
        pg.close()
    b.close()
