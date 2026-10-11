"""Open sheets from my library through the bridge and screenshot them.
usage: python tests/library_shots.py <page url> <bridge token> <out_dir> <title substring> [...]"""
import os, sys
from playwright.sync_api import sync_playwright

url, token, out = sys.argv[1], sys.argv[2], sys.argv[3]
names = sys.argv[4:]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 1000})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{url}#token={token}", wait_until="networkidle")
    for i, n in enumerate(names):
        pg.locator(".menu-btn", has_text="파일").click()
        pg.locator("[data-act=examples]").click()
        pg.wait_for_timeout(1200)
        if i == 0:
            print("library items:", pg.locator(".lib-list button").count())
        pg.locator(".lib-list button", has_text=n).first.click()
        pg.wait_for_timeout(1500)
        print(n, "| title:", pg.locator(".sheet-head h1").inner_text(), "| chips:", pg.locator(".chips").inner_text().replace("\n", " "),
              "| lines:", pg.locator(".sheet-line").count(), "| chords:", pg.locator(".all-chords svg").count())
        pg.screenshot(path=os.path.join(out, f"lib_{i}.png"))
    print("errors:", errs[:5])
    b.close()
