"""Frame-by-frame screen clips of the live site (15.11.2026).

Every frame is a screenshot of the real page at https://evge14n.github.io/spaceu-lunar-navigator/
taken after the page has finished drawing, so slow steps (the Now layer takes ~1 s) still give a
smooth 30 fps clip. Viewport 1440x810 CSS px at DPR 4/3 = 1920x1080 frames. A drawn cursor
(pointer-events: none) shows where the clicks go; it is not part of the site.

Usage: python frontend/scripts/record_clips.py OUTDIR [clip ...]   clips: map timeline compare shadows accuracy
Needs Python Playwright (Chromium) and ffmpeg on PATH. Published copies: frontend/public/clips/.
"""
import math, os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("CLIPS_BASE", "https://evge14n.github.io/spaceu-lunar-navigator/")
FPS = 30
OUT = sys.argv[1]
WANT = sys.argv[2:] or ["map", "timeline", "compare", "shadows", "accuracy"]

CURSOR_JS = r"""
(() => {
  if (window.__cur) return;
  const add = () => {
    const d = document.createElement('div');
    d.id = '__cur';
    d.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483647;pointer-events:none;display:none;transform-origin:0 0';
    d.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16 26.4 L11.6 17.2 L19.5 17.2 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    const r = document.createElement('div');
    r.id = '__ring';
    r.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;border:3px solid #E4572E;border-radius:50%;z-index:2147483646;pointer-events:none;opacity:0';
    document.documentElement.append(r, d);
    window.__cur = (x, y) => { d.style.display = 'block'; d.style.left = x + 'px'; d.style.top = y + 'px'; };
    window.__ring = (x, y, k) => { r.style.left = x + 'px'; r.style.top = y + 'px'; r.style.opacity = String(Math.max(0, 1 - k)); r.style.transform = `scale(${0.4 + k})`; };
  };
  if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
})();
"""


def ease(k):
    return 0.5 - 0.5 * math.cos(math.pi * k)


class Rec:
    def __init__(self, page, name):
        self.p = page
        self.dir = os.path.join(OUT, "frames_" + name)
        shutil.rmtree(self.dir, ignore_errors=True)
        os.makedirs(self.dir)
        self.n = 0
        self.name = name
        self.xy = (720, 500)

    def shot(self, k=1):
        """Capture the page once and hold it for k frames."""
        first = os.path.join(self.dir, f"{self.n:05d}.jpg")
        self.p.screenshot(path=first, type="jpeg", quality=94)
        self.n += 1
        for _ in range(k - 1):
            os.link(first, os.path.join(self.dir, f"{self.n:05d}.jpg"))
            self.n += 1

    def hold(self, sec):
        self.shot(max(1, round(sec * FPS)))

    def cursor(self, x, y):
        self.xy = (x, y)
        self.p.evaluate("([x,y]) => window.__cur && window.__cur(x,y)", [x, y])
        self.p.mouse.move(x, y)

    def move(self, x, y, sec=0.6):
        x0, y0 = self.xy
        n = max(2, round(sec * FPS))
        for i in range(1, n + 1):
            k = ease(i / n)
            self.cursor(x0 + (x - x0) * k, y0 + (y - y0) * k)
            self.shot()

    def click(self, x, y, after=None, sec=0.6):
        self.move(x, y, sec)
        self.p.mouse.click(x, y)
        if after:
            after()
        for i in range(8):
            self.p.evaluate("([x,y,k]) => window.__ring && window.__ring(x,y,k)", [x, y, i / 8])
            self.shot()
        self.p.evaluate("([x,y]) => window.__ring && window.__ring(x,y,1)", [x, y])

    def center(self, locator):
        b = locator.bounding_box()
        return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2

    def scroll_to(self, y, sec=1.2):
        y0 = self.p.evaluate("window.scrollY")
        n = max(2, round(sec * FPS))
        for i in range(1, n + 1):
            self.p.evaluate("y => window.scrollTo(0, y)", y0 + (y - y0) * ease(i / n))
            self.shot()

    def encode(self):
        mp4 = os.path.join(OUT, f"{self.name}.mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(self.dir, "%05d.jpg"),
             "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-color_range", "tv", "-profile:v", "high",
             "-r", str(FPS), "-an", "-movflags", "+faststart", mp4],
            check=True,
        )
        return mp4, self.n / FPS


def top_of(page, locator, margin):
    """Scroll position that puts the element `margin` px under the sticky header."""
    hh = page.evaluate("(() => { const h = document.querySelector('header'); return h ? h.getBoundingClientRect().height : 0 })()")
    return locator.bounding_box()["y"] + page.evaluate("window.scrollY") - hh - margin


def settle(page, ms=600):
    page.wait_for_timeout(ms)


def wait_light(page, prev_caption):
    """Wait until the Now layer shows a new moment and is not computing."""
    page.wait_for_function(
        """prev => { const c = document.querySelector('.map-cap'); const b = document.querySelector('.plate-busy');
                     const img = document.querySelector('.plate.plate-now > img');
                     return c && c.innerText !== prev && !b && img && img.complete; }""",
        arg=prev_caption, timeout=30000)
    page.wait_for_timeout(120)


def cap_text(page):
    return page.evaluate("document.querySelector('.map-cap') ? document.querySelector('.map-cap').innerText : ''")


def clip_map(page, r):
    page.goto(BASE + "#/map?site=site04", wait_until="networkidle")
    settle(page, 1500)
    plate = page.locator(".map-sheet")
    y = top_of(page, plate, 8)
    page.evaluate("y => window.scrollTo(0, y)", y)
    settle(page)
    r.cursor(1000, 600)
    r.hold(0.4)
    nx, ny = r.center(page.get_by_role("button", name="Now", exact=True))
    before = cap_text(page)
    r.click(nx, ny, after=lambda: wait_light(page, before))
    r.hold(0.3)
    sl = page.locator(".map-sheet input[type=range]")
    b = sl.bounding_box()
    v = float(sl.evaluate("e => e.value")); mx = float(sl.evaluate("e => e.max"))
    tx = b["x"] + 8 + (b["width"] - 16) * v / mx
    ty = b["y"] + b["height"] / 2
    r.move(tx, ty, 0.6)
    page.mouse.down()
    # 1 px of the year slider is about 10 h: the Sun walks round the horizon once in ~27 days.
    for i in range(1, 51):
        prev = cap_text(page)
        r.cursor(tx + i * 1.2, ty)
        page.mouse.move(tx + i * 1.2, ty)
        try:
            wait_light(page, prev)
        except Exception:
            pass
        r.shot(3)
    page.mouse.up()
    r.hold(0.6)


def clip_timeline(page, r):
    page.goto(BASE + "#/timeline?site=site04&h=1", wait_until="networkidle")
    settle(page, 1500)
    page.get_by_role("button", name="Darkest 30 days").click()
    settle(page, 800)
    sw = page.get_by_role("group", name="Instrument height above the ground")
    y = top_of(page, sw, 16)
    page.evaluate("y => window.scrollTo(0, y)", y)
    settle(page)
    r.cursor(1100, 420)
    r.hold(0.8)
    for h in ["2 m", "5 m", "10 m"]:
        x, yy = r.center(sw.get_by_role("button", name=h, exact=True))
        r.click(x, yy, after=lambda: settle(page, 700), sec=0.5)
        r.hold(1.1)
    r.hold(0.5)


def clip_compare(page, r):
    # starts at 4 of 4 (01-04): the other chips are dimmed and the hint says to remove one first
    page.goto(BASE + "#/compare?cmp=site01,site04,site06,site07", wait_until="networkidle")
    settle(page, 1200)
    r.cursor(900, 600)
    r.hold(0.6)
    for name in ["Peak near Shackleton", "Malapert massif"]:  # remove 04, then add 07: both clicks visibly change the table
        lab = page.locator("label.chip").filter(has_text=name).first
        x, y = r.center(lab)
        r.click(x - 30, y, after=lambda: settle(page, 500), sec=0.45)
        r.hold(0.5)
    assert page.locator("label.chip.on").filter(has_text="Malapert massif").count() == 1, "07 did not switch on"
    r.hold(0.4)
    t = page.get_by_role("region", name="Comparison table, scrolls sideways")
    y = t.bounding_box()["y"] + page.evaluate("window.scrollY") - 120
    r.scroll_to(y, 1.3)
    r.hold(1.0)
    m = page.get_by_role("region", name="Mast height table, scrolls sideways")
    y = m.bounding_box()["y"] + page.evaluate("window.scrollY") - 160
    r.scroll_to(y, 1.2)
    r.hold(1.0)


def clip_shadows(page, r):
    import datetime as dt
    t0 = dt.datetime(2026, 11, 20, 0, tzinfo=dt.timezone.utc)
    page.goto(BASE + f"#/horizon?site=site04&t={t0:%Y-%m-%dT%H:%MZ}", wait_until="networkidle")
    settle(page, 2500)
    page.get_by_role("button", name="From above").click()
    settle(page, 2500)
    sc = page.locator(".scene-panel")
    y = top_of(page, sc, 8)
    page.evaluate("y => window.scrollTo(0, y)", y)
    settle(page, 1500)
    r.hold(0.6)
    # time-lapse: 6 h per 2 frames, ~19 days in 6 s
    for i in range(1, 91):
        t = t0 + dt.timedelta(hours=6 * i)
        page.evaluate("h => { location.hash = h }", f"#/horizon?site=site04&t={t:%Y-%m-%dT%H:%MZ}")
        page.wait_for_timeout(90)
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
        r.shot(2)
    r.hold(0.6)


def clip_accuracy(page, r):
    page.goto(BASE + "#/accuracy", wait_until="networkidle")
    settle(page, 1200)
    r.hold(1.2)
    y = page.get_by_text("Sunlit share, site by site").bounding_box()["y"] + page.evaluate("window.scrollY") - 380
    r.scroll_to(y, 1.6)
    r.hold(1.2)
    y2 = page.get_by_text("Sunlit share, site by site").bounding_box()["y"] + page.evaluate("window.scrollY") - 40
    r.scroll_to(y2, 1.4)
    r.hold(1.6)


# CSS viewport and DPR per clip; every one gives 1920x1080 frames.
VIEW = {"timeline": (1600, 900, 1.2)}

CLIPS = {"map": clip_map, "timeline": clip_timeline, "compare": clip_compare, "shadows": clip_shadows, "accuracy": clip_accuracy}

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--headless=new", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"])
    for name in WANT:
        w, h, dpr = VIEW.get(name, (1440, 810, 4 / 3))
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr, color_scheme="light")
        ctx.add_init_script(CURSOR_JS)
        page = ctx.new_page()
        errs, bad = [], []
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("response", lambda resp: bad.append(f"{resp.status} {resp.url}") if resp.status >= 400 else None)
        r = Rec(page, name)
        t = time.time()
        CLIPS[name](page, r)
        mp4, dur = r.encode()
        print(f"{name}: {dur:.1f} s, {r.n} frames, {os.path.getsize(mp4)/1e6:.2f} MB, rec {time.time()-t:.0f} s, console errors {len(errs)}, 4xx/5xx {len(bad)}", errs[:3], bad[:3], flush=True)
        ctx.close()
    b.close()
