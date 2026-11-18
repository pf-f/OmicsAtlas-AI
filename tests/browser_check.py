"""Actual browser checks. Serves the site at its renamed GitHub Pages subpath."""

import copy
import csv
import io
import json
from pathlib import Path
import threading
import http.server
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".artifacts"
ARTIFACTS.mkdir(exist_ok=True)
DATA = json.loads((ROOT / "docs/data/catalog.json").read_text())


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "docs"), **kwargs)

    def do_GET(self):
        if self.path.startswith("/OmicsAtlas-AI/"):
            self.path = self.path[len("/OmicsAtlas-AI") :]
        return super().do_GET()

    def log_message(self, *args):
        pass


def run():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/OmicsAtlas-AI/"
    passed = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = browser.new_context(
            viewport={"width": 1440, "height": 900}, accept_downloads=True
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base)
        expect(page.locator(".tool-table")).to_be_visible()
        assert page.locator("tbody tr").count() == min(25, len(DATA["repositories"]))
        assert page.evaluate(
            "document.documentElement.scrollWidth <= window.innerWidth"
        )
        page.screenshot(path=str(ARTIFACTS / "directory-en.png"))
        passed.append("real catalog and renamed Pages subpath")
        # A tool outside the first page is searchable across all domains.
        target = next(
            r
            for r in reversed(DATA["repositories"])
            if not r["archived"] and not r["unavailable"]
        )
        page.get_by_role("searchbox").fill(target["full_name"])
        page.get_by_role("searchbox").press("Enter")
        expect(
            page.get_by_role("button", name=target["name"], exact=True)
        ).to_be_visible()
        page.reload()
        expect(
            page.get_by_role("button", name=target["name"], exact=True)
        ).to_be_visible()
        passed.append("full-library search and URL restoration")
        page.locator("#clear").click()
        page.locator('[data-domain="single-cell"]').click()
        expect(page.locator("#result-heading")).to_have_text("Single-cell")
        page.go_back()
        expect(page.locator('[data-domain=""]').first).to_have_attribute(
            "aria-pressed", "true"
        )
        page.locator("#pagination").get_by_role(
            "button", name="Next →", exact=True
        ).click()
        assert "page=2" in page.url
        page.reload()
        expect(page.locator(".page-controls")).to_contain_text("Page 2")
        passed.append("domain filters, browser back, pagination")
        page.goto(base)
        expect(page.locator(".tool-table")).to_be_visible()
        first = page.locator("tbody tr").first
        first.locator(".tool-name").click()
        expect(page.locator("#detail-dialog")).to_be_visible()
        page.keyboard.press("Escape")
        expect(first.locator(".tool-name")).to_be_focused()
        first.locator("[data-save]").click()
        page.reload()
        expect(page.locator("#saved-count")).to_have_text("1")
        page.locator("#saved").click()
        assert page.locator("tbody tr").count() == 1
        with page.expect_download() as event:
            page.locator("#export-saved").click()
        saved_path = ARTIFACTS / "saved.json"
        event.value.save_as(saved_path)
        saved = json.loads(saved_path.read_text())
        assert len(saved["saved"]) == 1
        page.locator("[data-save]").click()
        expect(page.locator(".empty")).to_be_visible()
        expect(page.locator(".empty button")).to_be_focused()
        page.locator("#import-file").set_input_files(saved_path)
        expect(page.locator("tbody tr")).to_have_count(1)
        passed.append("bookmark persistence, export, import, empty saved list")
        page.locator("#explore").click()
        page.locator("#clear").click()
        for i in range(4):
            page.locator("tbody tr").nth(i).locator("[data-compare]").click()
        page.locator("tbody tr").nth(4).locator("[data-compare]").click()
        expect(page.locator("#compare-count")).to_have_text("4 / 4 selected")
        page.locator("#compare-open").click()
        expect(page.locator("#compare-dialog")).to_be_visible()
        assert page.locator(".comparison thead th").count() == 5
        page.screenshot(path=str(ARTIFACTS / "comparison.png"))
        page.keyboard.press("Escape")
        expect(page.locator("#compare-dialog")).not_to_be_visible()
        passed.append("four-tool comparison limit and real comparison fields")
        page.locator("tbody tr").first.locator(".tool-name").click()
        expect(page.locator("#detail-dialog")).to_be_visible()
        expect(page.locator("#detail-dialog")).to_have_accessible_name(
            page.locator("#detail-content h2").inner_text()
        )
        expect(page.locator(".evidence-card").first).to_be_visible()
        assert (
            page.locator('#detail-content a[href^="https://github.com/"]').count() > 0
        )
        detail_save = page.locator("#detail-content [data-save]")
        before = detail_save.get_attribute("aria-pressed")
        detail_save.click()
        expect(detail_save).to_have_attribute(
            "aria-pressed", "false" if before == "true" else "true"
        )
        page.screenshot(path=str(ARTIFACTS / "detail.png"))
        if page.locator(".install-block button").count():
            page.locator(".install-block button").first.click()
            expect(page.locator("#detail-dialog #toast")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.locator("#detail-dialog")).not_to_be_visible()
        expect(page.locator("tbody tr").first.locator(".tool-name")).to_be_focused()
        passed.append("source evidence, detail actions, Escape and focus return")
        with page.expect_download() as event:
            page.locator(".export-menu summary").click()
            page.locator("#export-csv").click()
        csv_path = ARTIFACTS / "filtered.csv"
        event.value.save_as(csv_path)
        rows = list(
            csv.DictReader(io.StringIO(csv_path.read_text(encoding="utf-8-sig")))
        )
        expected = [
            r
            for r in DATA["repositories"]
            if not r["archived"] and not r["unavailable"]
        ]
        assert len(rows) == len(expected)
        passed.append("CSV parses and exports all results beyond the visible page")
        page.locator('[data-view="trending"]').click()
        trends = [
            r
            for r in DATA["repositories"]
            if (r.get("growth", {}).get("weekly_delta") or 0) > 0
            and not r["archived"]
            and not r["unavailable"]
        ]
        if trends:
            expect(page.locator("tbody tr").first).to_be_visible()
        else:
            expect(page.locator(".empty")).to_contain_text(
                "Growth is still taking shape"
            )
        page.locator('[data-view="new"]').click()
        page.locator("#clear").click()
        expect(page.locator("#sort")).to_have_value("new")
        page.locator("#more-filters summary").click()
        page.locator("#environment").select_option("docker")
        page.locator("#more-filters summary").click()
        page.locator("#sort").select_option("updated")
        assert not page.locator("#more-filters").evaluate("(n)=>n.open")
        page.locator("#clear").click()
        page.locator('[data-view="all"]').click()
        page.locator("#language").click()
        expect(page.locator("html")).to_have_attribute("lang", "zh-CN")
        page.locator("#search").fill("单细胞")
        page.locator("#search").press("Enter")
        expect(page.locator("tbody tr").first).to_be_visible()
        page.screenshot(path=str(ARTIFACTS / "directory-zh.png"))
        page.reload()
        expect(page.locator("html")).to_have_attribute("lang", "zh-CN")
        page.locator("#clear").click()
        page.locator("#compare-clear").click()
        page.set_viewport_size({"width": 1280, "height": 720})
        page.screenshot(path=str(ARTIFACTS / "desktop-1280.png"))
        assert page.evaluate(
            "document.documentElement.scrollWidth <= window.innerWidth"
        )
        # CSS zoom exercises reflow; it is explicitly not claimed as native
        # browser zoom. Keyboard focus and scrolling are checked separately.
        page.evaluate('document.documentElement.style.zoom="2"')
        page.screenshot(path=str(ARTIFACTS / "desktop-css-zoom-200.png"))
        assert page.evaluate(
            "document.documentElement.scrollWidth <= window.innerWidth"
        )
        page.evaluate('document.documentElement.style.zoom="1"')
        page.keyboard.press("/")
        expect(page.locator("#search")).to_be_focused()
        passed.append(
            "Chinese search, translation persistence, desktop sizes and CSS zoom reflow"
        )
        assert not errors, errors
        # Read-only mocked states: data failure, stale snapshot and hostile text.
        fail = browser.new_context().new_page()
        fail.route(
            "**/data/catalog.json",
            lambda route: route.fulfill(status=503, body="offline"),
        )
        fail.goto(base)
        expect(fail.locator(".empty")).to_contain_text("could not be loaded")
        fail.unroute("**/data/catalog.json")
        fail.get_by_role("button", name="Try again").click()
        expect(fail.locator(".tool-table")).to_be_visible()
        stress = copy.deepcopy(DATA)
        stress["generated_at"] = "2020-01-01T00:00:00Z"
        stress["repositories"][0]["name"] = '<img src=x onerror="window.injected=1">'
        stress["repositories"][0]["description"] = (
            "Long description <script>window.injected=1</script> " + ("tool " * 100)
        )
        stress["repositories"][0]["url"] = "javascript:alert(1)"
        sample = browser.new_context(viewport={"width": 1280, "height": 720})
        pg = sample.new_page()
        pg.route("**/data/catalog.json", lambda route: route.fulfill(json=stress))
        pg.goto(base)
        expect(pg.locator(".tool-table")).to_be_visible()
        expect(pg.locator("#snapshot-status")).to_contain_text("overdue")
        assert pg.evaluate("window.injected===undefined")
        assert pg.locator('a[href^="javascript:"]').count() == 0
        assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        passed.append(
            "load failure/retry, stale snapshot, HTML and URL injection defenses"
        )
        # Exercise pure search/export boundary behavior in the actual JS runtime.
        result = page.evaluate(
            """async()=>{const m=await import('./assets/logic.js');return {csv:m.csvExport([{full_name:'=FORMULA()',description:'@payload',domains:[],tasks:[],tool_types:[]}]),bad:m.safeUrl('javascript:alert(1)'),round:m.readState('?domain=single-cell&page=2&archived=1')};}"""
        )
        assert "'=FORMULA()" in result["csv"] and "'@payload" in result["csv"]
        assert result["bad"] is None
        assert result["round"]["page"] == 2 and result["round"]["archived"]
        passed.append("CSV formula safety and URL state boundaries")
        browser.close()
    server.shutdown()
    (ARTIFACTS / "browser-results.json").write_text(
        json.dumps({"passed": passed, "page_errors": errors}, indent=2) + "\n"
    )
    print("\n".join("PASS " + s for s in passed))


if __name__ == "__main__":
    run()
