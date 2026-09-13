#!/usr/bin/env python3
"""Prepare the ACA6 guide and disable its now-duplicated common footer."""

import json
from html.parser import HTMLParser
from pathlib import Path


class DetailParser(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.lines = html.splitlines(keepends=True)
        self.headings = []
        self.links = []
        self.media = []
        self.heading_start = None
        self.heading_text = ""
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "h3":
            line, column = self.getpos()
            self.heading_start = sum(map(len, self.lines[: line - 1])) + column
            self.heading_text = ""
        if tag == "a":
            self.links.append(attrs.get("href"))
        if tag in {"iframe", "img"}:
            self.media.append((tag, attrs.get("src")))

    def handle_data(self, data):
        if self.heading_start is not None:
            self.heading_text += data

    def handle_endtag(self, tag):
        if tag == "h3" and self.heading_start is not None:
            self.headings.append((self.heading_text.strip(), self.heading_start))
            self.heading_start = None


root = Path(__file__).resolve().parents[1]
artifacts = root / "artifacts/aca6-detail"
product = json.loads((artifacts / "before.json").read_text())["data"]
assert product["prodNo"] == 84 and "(ACA6)" in product["name"]
assert product["siteCode"] == "S20260516852c71a014d08"
assert product["useMobileProdContent"] == "N"
assert product["prodDigitalData"]["subscribeData"]["period"] == 40
old = product["content"]
parsed = DetailParser(old)
starts = [offset for title, offset in parsed.headings if title == "구매 후 이용 안내"]
assert len(starts) == 1, "Unexpected source guide structure; stop instead of guessing."
assert old.rstrip().endswith("</section>")
fragment = (root / "docs/previews/2026-09-13-aca6-use-refund.html").read_text()
description = old[: starts[0]] + fragment + "\n</section>"
after = DetailParser(description)
assert parsed.media == after.media, "Preview and thumbnail must remain unchanged."
assert parsed.links == after.links, "Watch and contact destinations must remain unchanged."
assert "재생 시작 후 환불" not in description
assert "구매 후 이용 안내" not in description
assert description.count('<section data-archive-pilates-tosspay="online-2026-07-30" data-ap-aca6-guide="2026-09-13"') == 1
assert description.count("http://pf.kakao.com/_AHdvn/chat") == 1
for term in ["40일", "7일", "1/3", "2/3", "1/2", "3개월", "30일", "소비자분쟁해결기준"]:
    assert term in fragment, term
payload = {
    "description": description,
    "unitCode": product["unitCode"],
    "commonFooterSettingType": "disabled",
}
(artifacts / "payload.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))
(artifacts / "description.html").write_text(description)
print(json.dumps({"prodNo": 84, "name": product["name"], "changedFields": ["description", "commonFooterSettingType"], "preservedPrefixCharacters": starts[0], "mediaUnchanged": True, "linksUnchanged": True}, ensure_ascii=False))
