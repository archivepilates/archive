"""Check the public Korean search contract without touching commerce or access."""
import json
from html.parser import HTMLParser
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "official-home"
ORIGIN = "https://archivepilates.com"


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.title, self.meta, self.canonical = [], {}, []
        self.h1, self.links, self.images, self.structured = 0, [], [], []
        self.in_title, self.json_text = False, None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "title":
            self.in_title = True
        if tag == "meta":
            self.meta.setdefault(attrs.get("name", attrs.get("property")), []).append(attrs.get("content", ""))
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonical.append(attrs["href"])
        if tag == "h1":
            self.h1 += 1
        if tag == "a":
            self.links.append(attrs.get("href", ""))
        if tag == "img":
            self.images.append(attrs)
        if tag == "script" and attrs.get("type") == "application/ld+json":
            self.json_text = ""

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.json_text is not None:
            self.json_text += data

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag == "script" and self.json_text is not None:
            self.structured.append(json.loads(self.json_text))
            self.json_text = None


routes = {"/": PUBLIC / "index.html", "/teams": PUBLIC / "teams/index.html", "/instructor-lessons": PUBLIC / "instructor-lessons/index.html"}
routes.update({"/teams/" + p.parent.name: p for p in (PUBLIC / "teams").glob("*/index.html")})
pages, titles = {}, set()
for route, filename in routes.items():
    page = Page(filename.read_text())
    title = "".join(page.title)
    assert title and title not in titles and len(title) <= 65, (route, "unique concise title")
    titles.add(title)
    assert "아카이브필라테스" in title, (route, "Korean brand")
    assert page.h1 == 1 and page.canonical == [ORIGIN + route], (route, "heading/canonical")
    assert page.meta.get("robots") == ["index,follow,max-image-preview:large"], route
    description = page.meta.get("description", [])
    assert len(description) == 1 and 25 <= len(description[0]) <= 80, (route, "description")
    assert page.meta.get("og:title") == [title], (route, "Open Graph title")
    assert page.meta.get("og:url") == [ORIGIN + route], (route, "Open Graph URL")
    for image in page.images:
        assert image.get("alt") and image.get("width") and image.get("height"), (route, "image description/dimensions")
        if image.get("src", "").startswith("/"):
            assert (PUBLIC / image["src"].lstrip("/")).exists(), (route, image)
    pages[route] = page

assert "정유리 필라테스 강사" in "".join(pages["/teams/yuri"].title)
for route in ["/", "/instructor-lessons"]:
    assert "강사레슨" in "".join(pages[route].title) and "강사교육" in "".join(pages[route].title)
assert "/instructor-lessons" in pages["/"].links
assert "/instructor-lessons" in pages["/teams"].links
guide = pages["/instructor-lessons"]
assert "/offline" in guide.links and "https://archivepilates.imweb.me/17" in guide.links
assert any(x.get("@type") == "WebSite" for x in pages["/"].structured)
assert any(x.get("@type") == "WebPage" for x in guide.structured)
ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
urls = ET.parse(PUBLIC / "sitemap.xml").findall("s:url", ns)
locations = [entry.findtext("s:loc", namespaces=ns) for entry in urls]
assert len(locations) == len(set(locations))
assert all(ORIGIN + route in locations for route in routes)
assert "Allow: /" in (PUBLIC / "robots.txt").read_text()
print(f"Validated Korean SEO: {len(routes)} pages, unique metadata, structured data, internal links and sitemap.")
