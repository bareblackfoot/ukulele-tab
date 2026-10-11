"""Stamp a version on every script and the stylesheet in index.html so browsers fetch new files after a push.
GitHub Pages lets browsers keep files for 10 minutes; a changed version string means a new address.

    python tools/stamp.py      (run before each commit)

The version is a hash of the files' contents, so it only changes when they do. Module imports inside the
scripts ("./model.js") are mapped to versioned addresses by an import map in index.html.
"""
import hashlib
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
js = sorted((root / "js").glob("*.js"))
h = hashlib.sha1()
for f in js + [root / "css" / "app.css"]:
    h.update(f.read_bytes().replace(b"\r\n", b"\n"))
ver = h.hexdigest()[:10]

idx = root / "index.html"
s = idx.read_text(encoding="utf-8")
before = s
imap = {"imports": {f"./js/{f.name}": f"./js/{f.name}?v={ver}" for f in js if f.name != "mic-worklet.js"}}
block = f'<!-- importmap -->\n<script type="importmap">{json.dumps(imap, separators=(",", ":"))}</script>\n<!-- /importmap -->'
if "<!-- importmap -->" in s:
    s = re.sub(r"<!-- importmap -->.*?<!-- /importmap -->", lambda m: block, s, flags=re.S)
else:
    s = s.replace("</head>", block + "\n</head>", 1)
s = re.sub(r'href="css/app\.css(\?v=[0-9a-f]+)?"', f'href="css/app.css?v={ver}"', s)
s = re.sub(r'<script type="module" src="js/main\.js(\?v=[0-9a-f]+)?"></script>', f'<script type="module" src="js/main.js?v={ver}"></script>', s)
assert s.count(f"?v={ver}") >= 3, "stamp did not apply"
if s != before:
    idx.write_text(s, encoding="utf-8")
print("version", ver, "(changed)" if s != before else "(same)")
