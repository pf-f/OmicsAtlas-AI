"""Check actual Chromium 200% browser zoom using a temporary local extension.

The extension runs only in an isolated test profile and is removed afterwards.
It is not part of the application or a change to the user's browser settings.
"""

import http.server
import json
from pathlib import Path
import tempfile
import threading

from playwright.sync_api import sync_playwright, expect
from browser_check import Handler, ARTIFACTS


def run():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/OmicsAtlas-AI/"
    try:
        with tempfile.TemporaryDirectory() as temporary, sync_playwright() as p:
            root = Path(temporary)
            extension = root / "extension"
            extension.mkdir()
            (extension / "manifest.json").write_text(
                json.dumps(
                    {
                        "manifest_version": 3,
                        "name": "Local zoom validation",
                        "version": "1.0",
                        "host_permissions": ["http://127.0.0.1/*"],
                        "background": {"service_worker": "worker.js"},
                    }
                )
            )
            (extension / "worker.js").write_text(
                "chrome.runtime.onInstalled.addListener(() => {});"
            )
            context = p.chromium.launch_persistent_context(
                str(root / "profile"),
                channel="chromium",
                headless=True,
                no_viewport=True,
                args=[
                    "--no-sandbox",
                    "--window-size=1440,1000",
                    f"--disable-extensions-except={extension}",
                    f"--load-extension={extension}",
                ],
            )
            worker = (
                context.service_workers[0]
                if context.service_workers
                else context.wait_for_event("serviceworker")
            )
            page = context.new_page()
            page.goto(base)
            expect(page.locator(".tool-table")).to_be_visible()
            before = page.evaluate("({width:innerWidth,dpr:devicePixelRatio})")
            level = worker.evaluate("""async()=>{
                const [tab]=await chrome.tabs.query({url:'http://127.0.0.1/*'});
                await chrome.tabs.setZoom(tab.id,2);return chrome.tabs.getZoom(tab.id);
            }""")
            page.wait_for_function("devicePixelRatio >= 2")
            after = page.evaluate(
                "({width:innerWidth,dpr:devicePixelRatio,cssZoom:document.documentElement.style.zoom,overflow:document.documentElement.scrollWidth>innerWidth})"
            )
            assert level == 2 and after["dpr"] >= 2 and not after["overflow"], after
            assert after["cssZoom"] == ""
            # CDP's legacy viewport dimensions account for native tab zoom.
            # Playwright's default screenshot clip would crop half the page.
            import base64

            session = context.new_cdp_session(page)
            viewport = session.send("Page.getLayoutMetrics")["layoutViewport"]
            capture = session.send(
                "Page.captureScreenshot",
                {
                    "format": "png",
                    "captureBeyondViewport": True,
                    "clip": {
                        "x": 0,
                        "y": 0,
                        "width": viewport["clientWidth"],
                        "height": viewport["clientHeight"],
                        "scale": 1,
                    },
                },
            )
            (ARTIFACTS / "desktop-native-zoom-200.png").write_bytes(
                base64.b64decode(capture["data"])
            )
            page.locator("#search").fill("scanpy")
            page.locator("#search").press("Enter")
            trigger = page.get_by_role("button", name="scanpy", exact=True)
            expect(trigger).to_be_visible()
            trigger.click()
            expect(page.locator("#detail-dialog")).to_be_visible()
            page.keyboard.press("Escape")
            expect(trigger).to_be_focused()
            result = {
                "native_zoom_factor": level,
                "before": before,
                "after": after,
                "passed": ["reflow", "search", "detail", "Escape and focus return"],
                "mechanism": "chrome.tabs.setZoom in an isolated temporary Chromium profile; CSS zoom unset.",
            }
            (ARTIFACTS / "native-zoom-results.json").write_text(
                json.dumps(result, indent=2) + "\n"
            )
            print(json.dumps(result))
            context.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    run()
