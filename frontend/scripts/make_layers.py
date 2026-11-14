"""Web-friendly copy of the illumination layer: data/illumination.png (1.6 MB) -> public/layers/illumination.webp (~0.4 MB).
The build uses the copy only while its recorded sha256 matches the current PNG (vite.config.ts), so a stale copy is never shown.
Run after the backend updates the PNG: python frontend/scripts/make_layers.py   (needs pillow)
"""
import hashlib, json, os
from PIL import Image

root = os.path.join(os.path.dirname(__file__), "..", "..")
src = os.path.join(root, "data", "illumination.png")
out = os.path.join(root, "frontend", "public", "layers")
os.makedirs(out, exist_ok=True)
sha = hashlib.sha256(open(src, "rb").read()).hexdigest()
Image.open(src).convert("L").save(os.path.join(out, "illumination.webp"), "WEBP", quality=80, method=6)
json.dump({"source": "data/illumination.png", "source_sha256": sha}, open(os.path.join(out, "illumination.webp.json"), "w"), indent=1)
print("ok", sha[:12], os.path.getsize(os.path.join(out, "illumination.webp")))
