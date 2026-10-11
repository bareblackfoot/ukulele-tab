"""Live page + local bridge: pair with the token link, list jobs, open the newest finished job.
usage: python tests/bridge_e2e.py <page url> <token> <out_dir>"""
import os
import sys
from playwright.sync_api import sync_playwright

url, token, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    try:
        ctx.grant_permissions(["local-network-access"], origin=url.split("/ukulele-tab")[0])
    except Exception as e:  # older Chromium has no such permission and does not need it
        print("permission note:", str(e).splitlines()[0][:120])
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    pg.goto(f"{url}#token={token}", wait_until="networkidle")
    pg.wait_for_timeout(600)
    print("address after pairing has no token:", "token=" not in pg.url)
    pg.locator("[data-act=transcribe]").click()
    pg.wait_for_timeout(1500)
    print("connection:", pg.locator(".tx-conn").inner_text())
    jobs = pg.locator(".tx-jobs .job")
    print("jobs listed:", jobs.count())
    pg.screenshot(path=os.path.join(out, "b1_dialog.png"))
    pg.locator(".tx-jobs .job button", has_text="열기").first.click()
    pg.wait_for_timeout(800)
    if pg.locator(".dlg-import[open]").count():
        pg.locator(".dlg-import [value=ok]").click()
    pg.wait_for_timeout(2500)
    print("title:", pg.locator(".sheet-head h1").inner_text())
    print("status:", pg.locator(".status").inner_text()[:200])
    print("sheet lines:", pg.locator(".sheet-line").count(), "| distinct chord diagrams:", pg.locator(".all-chords svg").count())
    pg.screenshot(path=os.path.join(out, "b2_loaded.png"))
    print("errors:", errs[:6])
    b.close()
