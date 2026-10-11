"""Headless check of practice mode, chord practice view and fake-microphone input.
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

    # 1. practice mode with keyboard input: press J on every beat for a few bars
    pg.locator("[data-act=practice]").click()
    pg.wait_for_timeout(400)
    print("state:", pg.locator(".g-state").inner_text())
    pg.locator("[data-act=play]").click()
    beat_ms = 60000 / 96
    for i in range(10):
        pg.wait_for_timeout(int(beat_ms))
        pg.keyboard.press("j")
    pg.wait_for_timeout(300)
    counts = {el.get_attribute("data-c"): el.inner_text() for el in pg.locator(".g-counts [data-c]").all()}
    print("counts after 10 key strums:", counts)
    pg.screenshot(path=os.path.join(out, "p1_practice.png"))
    pg.locator("[data-act=play]").click()

    # 2. chord practice view
    pg.locator("[data-act=drill]").click()
    pg.wait_for_timeout(300)
    print("drill steps:", pg.locator(".dr-step").count(), "| chord cards:", pg.locator(".dr-card").count())
    pg.locator("[data-dr=self]").click()
    pg.locator("[data-dr=self]").click()
    pg.locator("[data-dr=self]").click()
    pg.wait_for_timeout(200)
    print("after 3 self checks:", pg.locator(".verdict").inner_text(), "| done cards:", pg.locator(".dr-card.done").count())
    pg.screenshot(path=os.path.join(out, "p2_drill1.png"))
    pg.locator("[data-step='2']").click()
    pg.wait_for_timeout(200)
    print("pairs:", pg.locator(".dr-pair").count())
    pg.screenshot(path=os.path.join(out, "p3_drill2.png"))
    pg.locator(".dr-pair [data-dr=pair]").first.click()
    pg.wait_for_timeout(2500)
    print("drill title:", pg.locator(".status").inner_text())
    pg.screenshot(path=os.path.join(out, "p4_pairrun.png"))
    pg.locator("[data-act=play]").click()

    # 3. fake microphone: switch input to mic and see that samples arrive
    pg.select_option(".g-input", "mic")
    pg.wait_for_timeout(1500)
    print("mic state:", pg.locator(".g-state").inner_text(), "| meter width:", pg.locator(".g-meter i").evaluate("e => e.style.width"))
    pg.locator("[data-act=view-sheet]").click()
    pg.wait_for_timeout(300)
    print("back to song:", pg.locator(".sheet-head h1").inner_text())
    print("errors:", errs[:10])
    b.close()
