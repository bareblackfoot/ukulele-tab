"""Headless check of game mode (count-in, judging, result saved), chord practice and the records view.
usage: python tests/practice_smoke.py <url> <out_dir>"""
import os
import sys
from playwright.sync_api import sync_playwright

url, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream",
                                "--use-fake-device-for-media-stream"])
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, permissions=["microphone"])
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    pg.goto(url + "?example=twinkle", wait_until="networkidle")
    pg.evaluate("localStorage.clear(); localStorage.setItem('uketab.practice.input', JSON.stringify('keys'))")
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(500)
    print("status line hidden at start:", pg.locator(".status").is_hidden())

    # 1. game mode: count-in, then press J on every beat for a few bars
    pg.locator("[data-act=practice]").click()
    pg.wait_for_timeout(300)
    print("button:", pg.locator("[data-act=practice]").inner_text(), "| state:", pg.locator(".g-state").inner_text())
    import time
    pg.locator("[data-act=play]").click()
    t_click = time.monotonic()
    beat = 60 / 96
    shown = set()
    while time.monotonic() - t_click < 0.6 + 3.5 * beat:
        if not pg.locator(".countdown").is_hidden():
            shown.add(pg.locator(".countdown").inner_text())
        time.sleep(0.05)
    print("count-in shown:", sorted(shown))
    start = t_click + 0.6 + 4 * beat + 0.03  # first beat of the song
    for i in range(12):
        while time.monotonic() < start + i * beat:
            time.sleep(0.002)
        pg.keyboard.press("j")
    time.sleep(0.4)
    counts = {el.get_attribute("data-c"): el.inner_text() for el in pg.locator(".g-counts [data-c]").all()}
    print("counts after 12 key strums:", counts)
    pg.screenshot(path=os.path.join(out, "g1_game.png"))
    pg.locator("[data-act=practice]").click()  # turning game mode off shows the result
    pg.wait_for_timeout(400)
    print("result dialog:", pg.locator(".dlg-gresult[open] .gr-meta").inner_text()[:120].replace("\n", " "))
    pg.screenshot(path=os.path.join(out, "g2_result.png"))
    pg.locator(".dlg-gresult [value=close]").click()

    # 2. chord practice view
    pg.locator("[data-act=drill]").click()
    pg.wait_for_timeout(300)
    print("transport hidden in chord practice:", pg.locator(".transport").is_hidden(), "| chord:", pg.locator(".dr-name").inner_text().split("\n")[0])
    pg.locator("[data-dr=next]").click()
    pg.wait_for_timeout(200)
    print("after next:", pg.locator(".dr-name").inner_text().split("\n")[0], "| finger lines:", pg.locator(".dr-fingers li").count())
    pg.screenshot(path=os.path.join(out, "g3_learn.png"))
    pg.locator("[data-dr=mode-change]").click()
    pg.wait_for_timeout(200)
    pg.locator("[data-dr=go]").click()
    pg.wait_for_timeout(3500)
    print("change drill tally:", pg.locator(".dr-tally").inner_text())
    pg.screenshot(path=os.path.join(out, "g4_change.png"))
    pg.locator("[data-dr=go]").click()

    # 3. records view
    pg.locator("[data-act=records]").click()
    pg.wait_for_timeout(600)
    print("records rows:", pg.locator(".db-table tbody tr").count(), "| tiles:", pg.locator(".db-tile").count())
    pg.locator(".db-table tbody tr").first.click()
    pg.wait_for_timeout(300)
    print("detail chart points:", pg.locator(".db-chart .pt").count())
    pg.screenshot(path=os.path.join(out, "g5_records.png"))
    pg.locator("[data-act=view-sheet]").click()
    pg.wait_for_timeout(300)
    print("back to sheet, transport visible:", pg.locator(".transport").is_visible())
    print("errors:", errs[:10])
    b.close()
