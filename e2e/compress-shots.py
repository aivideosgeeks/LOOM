"""Resize and re-encode the screenshots so they can be embedded inline in the handbook."""
import base64
import glob
import json
import os

from PIL import Image

SRC = os.path.join(os.path.dirname(__file__), "shots")
OUT = os.path.join(os.path.dirname(__file__), "shots-web")
MANIFEST = os.path.join(os.path.dirname(__file__), "shots.json")

os.makedirs(OUT, exist_ok=True)
manifest = {}
total_before = 0
total_after = 0

for path in sorted(glob.glob(os.path.join(SRC, "*.png"))):
    name = os.path.splitext(os.path.basename(path))[0]
    before = os.path.getsize(path)
    total_before += before

    im = Image.open(path).convert("RGB")
    # Tall full-page captures keep more width; everything else fits a document column.
    max_w = 1000 if im.height > im.width * 1.4 else 1200
    if im.width > max_w:
        ratio = max_w / im.width
        im = im.resize((max_w, int(im.height * ratio)), Image.LANCZOS)

    dest = os.path.join(OUT, f"{name}.webp")
    im.save(dest, "WEBP", quality=72, method=6)
    after = os.path.getsize(dest)
    total_after += after

    with open(dest, "rb") as fh:
        manifest[name] = "data:image/webp;base64," + base64.b64encode(fh.read()).decode("ascii")

    print(f"  {name:36s} {im.width}x{im.height}  {before // 1024:5d}KB -> {after // 1024:4d}KB")

with open(MANIFEST, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh)

payload = os.path.getsize(MANIFEST)
print(f"\n{len(manifest)} images")
print(f"PNG total   {total_before / 1024 / 1024:.1f} MB")
print(f"WebP total  {total_after / 1024 / 1024:.1f} MB")
print(f"Inlined     {payload / 1024 / 1024:.1f} MB of base64")
