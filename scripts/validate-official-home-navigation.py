from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "official-home"
ASSETS = ("/assets/academy-nav-20260915.css", "/assets/academy-nav-20260915.js")
DESTINATIONS = {
    "team": "/teams",
    "lesson": "/offline",
    "video": "https://archivepilates.imweb.me/17",
    "products": "/shop",
    "community": "https://archivepilates.imweb.me/community",
    "career": "/careers",
}


class Navigation(HTMLParser):
    def __init__(self):
        super().__init__()
        self.header = False
        self.academy = False
        self.top = []
        self.children = []
        self.links = {}
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        asset = attrs.get("src") or attrs.get("href")
        if asset in ASSETS:
            self.assets.append(asset)
        if tag == "header":
            self.header = True
        if not self.header:
            return
        if tag == "details":
            assert attrs.get("class") == "nav-academy"
            assert "open" not in attrs
            self.academy = True
        key = attrs.get("data-nav")
        if tag == "summary":
            assert self.academy and key == "academy"
            assert attrs.get("aria-controls") == "academy-links"
            self.top.append(key)
        if tag == "a" and key:
            assert key not in self.links
            self.links[key] = attrs.get("href")
            (self.children if self.academy else self.top).append(key)

    def handle_endtag(self, tag):
        if tag == "details":
            self.academy = False
        if tag == "header":
            self.header = False


pages = [ROOT / "index.html", ROOT / "instructor-lessons/index.html"]
pages += sorted((ROOT / "teams").rglob("index.html"))
assert len(pages) == 8
for page in pages:
    nav = Navigation()
    nav.feed(page.read_text())
    assert nav.top == ["team", "academy", "community", "career"], page
    assert nav.children == ["lesson", "video", "products"], page
    assert nav.links == DESTINATIONS, page
    assert nav.assets == list(ASSETS), page
for asset in ASSETS:
    assert (ROOT / asset.lstrip("/")).is_file(), asset
print("Validated 8 official headers: 4 top-level controls, 3 Academy links, unchanged destinations.")
