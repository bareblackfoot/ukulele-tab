"""Headless smoke test: load the app from a URL, check for page errors, play a little, open the editor, save screenshots.
usage: python tests/smoke.py http://127.0.0.1:8099/ out_dir"""
import sys, os, json
from playwright.sync_api import sync_playwright

url, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": 1280, "height": 860})
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    pg.goto(url, wait_until="networkidle")
    pg.wait_for_timeout(800)
    print("status:", pg.locator(".status").inner_text())
    print("chordbar items:", pg.locator(".cb-item").count(), "| sheet lines:", pg.locator(".sheet-line").count())
    pg.screenshot(path=os.path.join(out, "1_sheet.png"))
    pg.locator("[data-act=play]").click()
    pg.wait_for_timeout(3500)
    print("time while playing:", pg.locator(".time").inner_text(), "| current chord box:", pg.locator(".cb-item.cur").count())
    pg.screenshot(path=os.path.join(out, "2_playing.png"))
    pg.locator("[data-act=play]").click()
    pg.locator("[data-act=edit]").click()
    pg.wait_for_timeout(500)
    pg.screenshot(path=os.path.join(out, "3_editor.png"))
    # type a fret into the A string row at column 0 and check it lands in the score
    box = pg.locator(".ed-canvas").bounding_box()
    pg.mouse.click(box["x"] + 52 + 18 * 1 + 5, box["y"] + 20 * 4 + 26 + 24 + 11)
    pg.keyboard.press("7")
    pg.wait_for_timeout(200)
    saved = pg.evaluate("localStorage.getItem('uketab.last')")
    pg.wait_for_timeout(600)
    saved = json.loads(pg.evaluate("localStorage.getItem('uketab.last')"))
    print("notes on A string at col 1:", [n for n in saved["tracks"][0]["notes"] if n["col"] == 1 and n["string"] == 3])
    pg.keyboard.press("Control+z")
    pg.wait_for_timeout(600)
    saved = json.loads(pg.evaluate("localStorage.getItem('uketab.last')"))
    print("after undo:", [n for n in saved["tracks"][0]["notes"] if n["col"] == 1 and n["string"] == 3])
    print("errors:", errs[:10])
    b.close()
