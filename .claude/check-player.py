"""Headless check of the player's rail/fill/thumb geometry + fills.

usage: python .claude/check-player.py [port] [engine] [dpr]
  engine: chromium | firefox   (default chromium)
  dpr:    device scale factor  (default 1)
"""
import asyncio, sys
from playwright.async_api import async_playwright

async def main():
    port = sys.argv[1] if len(sys.argv) > 1 else "8000"
    engine = sys.argv[2] if len(sys.argv) > 2 else "chromium"
    dpr = float(sys.argv[3]) if len(sys.argv) > 3 else 1
    url = f"http://127.0.0.1:{port}/"
    thumb_pseudo = "::-webkit-slider-thumb" if engine == "chromium" else "::-moz-range-thumb"
    async with async_playwright() as p:
        b = await (p.chromium if engine == "chromium" else p.firefox).launch()
        pg = await b.new_page(device_scale_factor=dpr, viewport={"width": 1280, "height": 800})
        errors = []
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(url)
        await pg.wait_for_timeout(800)

        async def measure():
            async def r(sel):
                return await pg.evaluate(
                    "(sel) => { const el = document.querySelector(sel); if (!el) return null;"
                    " const cs = getComputedStyle(el); return { h: cs.height, w: cs.width }; }", sel)
            async def pseudo(sel, which):
                return await pg.evaluate(
                    "(a) => { const el = document.querySelector(a[0]); if (!el) return null;"
                    " const cs = getComputedStyle(el, a[1]); return { h: cs.height, w: cs.width, bg: cs.backgroundColor }; }",
                    [sel, which])
            return {
                "player h/w": await r(".player"),
                "seek-track": await r(".seek-track"),
                "seek ::before": await pseudo(".seek-track", "::before"),
                "seek ::after": await pseudo(".seek-track", "::after"),
                "seek thumb": await pseudo(".seek-slider", thumb_pseudo),
                "volume-track": await r(".volume-track"),
                "volume ::before": await pseudo(".volume-track", "::before"),
                "volume ::after": await pseudo(".volume-track", "::after"),
                "volume thumb": await pseudo(".volume-slider", thumb_pseudo),
            }

        print(f"== {engine} dpr {dpr} at rest ==")
        for k, v in (await measure()).items():
            print(f"  {k}: {v}")

        await pg.evaluate("""
          () => {
            const p = document.querySelector('.player');
            p.style.setProperty('--p', 0.618);
            p.style.setProperty('--v', 0.4);
          }
        """)
        await pg.wait_for_timeout(100)
        print(f"== {engine} dpr {dpr} with --p .618 / --v .4 ==")
        for k, v in (await measure()).items():
            if "::" in k:
                print(f"  {k}: {v}")

        print("== console errors ==")
        print("  " + "\n  ".join(errors) if errors else "  none")

        # pixel-level assertions: computed styles can lie (chrome paints a UA
        # track band over the fill), so prove the fill and thumb really render
        from PIL import Image
        from collections import Counter

        async def region_counts(sel, name):
            await pg.locator(sel).scroll_into_view_if_needed()
            await pg.wait_for_timeout(200)
            box = await pg.locator(sel).bounding_box()
            await pg.screenshot(path=f"C:/tmp/chk-{engine}-{name}.png",
                                clip={"x": box["x"] - 2, "y": box["y"] - 2,
                                      "width": box["width"] + 4, "height": box["height"] + 4})
            im = Image.open(f"C:/tmp/chk-{engine}-{name}.png").convert("RGB")
            return Counter(im.getdata())

        FILL = (169, 177, 186)
        c = await region_counts(".seek-track", "seekfill")
        fill_px = sum(n for (r, g, b), n in c.items() if abs(r - FILL[0]) <= 8 and abs(g - FILL[1]) <= 8 and abs(b - FILL[2]) <= 8)
        print(f"== {engine}: fill pixels in seek track: {fill_px} (expect ~2700 at dpr 1)")
        assert fill_px > 500, "fill did not render"

        # hover the seek thumb and confirm it paints
        sb = await pg.locator(".seek-track").bounding_box()
        await pg.mouse.move(sb["x"] + sb["width"] * 0.6, sb["y"] + sb["height"] / 2)
        await pg.wait_for_timeout(400)
        c = await region_counts(".seek-track", "seekthumb")
        white_px = sum(n for (r, g, b), n in c.items() if r > 240 and g > 240 and b > 240)
        print(f"== {engine}: white thumb pixels on hover: {white_px} (expect ~100)")
        assert white_px > 30, "thumb did not render on hover"

        await pg.screenshot(path=f"C:/tmp/player-{engine}-dpr{str(dpr).replace('.', '_')}.png",
                            clip={"x": 0, "y": 0, "width": 900, "height": 300})
        await b.close()

asyncio.run(main())
