"""Page + bridge: sign up in the login dialog, finish a short game with the keyboard, see it under the account.
usage: python tests/account_e2e.py <page url> <bridge token>   (creates and leaves account zz_e2e; delete it after)"""
import sys, time
from playwright.sync_api import sync_playwright

url, token = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    try:
        ctx.grant_permissions(["local-network-access"], origin=url.split("/ukulele-tab")[0] if "github.io" in url else url.rstrip("/"))
    except Exception:
        pass
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{url}?example=twinkle#token={token}", wait_until="networkidle")
    pg.evaluate("localStorage.setItem('uketab.practice.input', JSON.stringify('keys'))")
    pg.wait_for_timeout(400)
    pg.locator("[data-act=account]").click()
    pg.fill(".dlg-login [name=id]", "zz_e2e")
    pg.fill(".dlg-login [name=pin]", "5827")
    pg.locator("[data-act=lg-signup]").click()
    pg.wait_for_timeout(1500)
    print("account button:", pg.locator("[data-act=account]").inner_text(), "| dialog msg:", pg.locator(".lg-msg").inner_text())
    pg.locator("[data-act=practice]").click()
    pg.wait_for_timeout(300)
    pg.locator("[data-act=play]").click()
    t = time.monotonic(); beat = 60 / 96
    start = t + 0.6 + 4 * beat + 0.03
    for i in range(8):
        while time.monotonic() < start + i * beat:
            time.sleep(0.002)
        pg.keyboard.press("j")
    time.sleep(0.3)
    pg.locator("[data-act=practice]").click()
    pg.wait_for_timeout(1200)
    print("result:", pg.locator(".dlg-gresult[open] .gr-meta").inner_text().replace("\n", " ")[:100])
    pg.locator(".dlg-gresult [value=close]").click()
    pg.locator("[data-act=records]").click()
    pg.wait_for_timeout(1500)
    print("records header:", pg.locator(".records-view .dr-head").inner_text().replace("\n", " "))
    print("rows:", pg.locator(".db-table tbody tr").count())
    print("errors:", errs[:5])
    b.close()
