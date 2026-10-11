#!/usr/bin/env python3
"""Generate or check CORE favicons locally; no browser or service access."""

import argparse
import hashlib
import io
import json
import struct
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlsplit

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "core"
SOURCE = CORE / "icons/archive-pilates-icon-512.png"
SOURCE_SHA256 = "f36b9a28c532261e0a364c401457340d2398132079779f59409a52f2587149f2"
VERSION = "20261011"
ICO_SIZES = (16, 32, 48, 64, 128, 256)


def official_source():
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_SHA256, (
        "Official 512px source changed; do not silently regenerate a new design"
    )
    with Image.open(SOURCE) as image:
        assert image.format == "PNG" and image.size == (512, 512)
        return image.convert("RGBA")


def generate():
    image = official_source()
    for size in (16, 32):
        image.resize((size, size), Image.Resampling.LANCZOS).save(
            CORE / f"icons/favicon-{size}.png", format="PNG"
        )
    image.resize((32, 32), Image.Resampling.LANCZOS).save(
        CORE / "favicon.png", format="PNG"
    )
    image.save(
        CORE / "favicon.ico", format="ICO", sizes=[(s, s) for s in ICO_SIZES]
    )
    print("Generated ICO and 16/32px PNGs from unchanged official source")


class HeadLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_head = False
        self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "head":
            self.in_head = True
        if self.in_head and tag == "base":
            raise AssertionError("A base element changes relative favicon resolution")
        if self.in_head and tag == "link":
            rel = set(attrs.get("rel", "").split())
            if rel & {"icon", "apple-touch-icon", "manifest"}:
                self.links.append(attrs)

    def handle_endtag(self, tag):
        if tag == "head":
            self.in_head = False


def resolve_asset(href, document_url, public_root, mount):
    assert not urlsplit(href).scheme and not href.startswith("/"), href
    assert parse_qs(urlsplit(href).query) == {"v": [VERSION]}, href
    resolved = urlsplit(urljoin(document_url, href))
    assert resolved.netloc == urlsplit(document_url).netloc
    assert resolved.path.startswith(mount), resolved.path
    target = public_root / resolved.path.lstrip("/")
    assert target.is_file(), f"Missing local asset for {document_url}: {target}"
    assert target.resolve().is_relative_to(CORE.resolve()), target
    return target


def verify_png(path, size):
    with Image.open(path) as image:
        assert image.format == "PNG" and image.size == (size, size), path
        image.verify()


def check():
    source = official_source()
    for size in (16, 32):
        path = CORE / f"icons/favicon-{size}.png"
        verify_png(path, size)
        with Image.open(path) as image:
            expected = source.resize((size, size), Image.Resampling.LANCZOS)
            assert image.convert("RGBA").tobytes() == expected.tobytes(), path
            assert image.convert("RGBA").getextrema()[3] == (255, 255), path
    assert (CORE / "favicon.png").read_bytes() == (
        CORE / "icons/favicon-32.png"
    ).read_bytes()

    data = (CORE / "favicon.ico").read_bytes()
    assert struct.unpack_from("<HHH", data) == (0, 1, len(ICO_SIZES))
    end = 6 + 16 * len(ICO_SIZES)
    dimensions = []
    for index in range(len(ICO_SIZES)):
        width, height, colors, reserved, planes, bits, length, offset = (
            struct.unpack_from("<BBBBHHII", data, 6 + 16 * index)
        )
        size = width or 256
        assert size == (height or 256) and colors == reserved == 0
        assert planes in (0, 1) and bits == 32
        assert offset == end and length > 0 and offset + length <= len(data)
        payload = data[offset:offset + length]
        with Image.open(io.BytesIO(payload)) as image:
            assert image.format == "PNG" and image.size == (size, size)
            image.verify()
        dimensions.append(size)
        end = offset + length
    assert tuple(dimensions) == ICO_SIZES and end == len(data)
    with Image.open(CORE / "favicon.ico") as icon:
        assert icon.format == "ICO"
        assert icon.ico.sizes() == {(s, s) for s in ICO_SIZES}
        for size in ICO_SIZES:
            expected = source.resize((size, size), Image.Resampling.LANCZOS)
            assert icon.ico.getimage((size, size)).convert("RGBA").tobytes() == (
                expected.tobytes()
            ), f"ICO frame {size} differs from official source resize"

    hosting = json.loads((ROOT / "firebase.json").read_text())["hosting"]
    core_host = next(h for h in hosting if h["site"] == "archive-pilates-core")
    fallback_host = next(h for h in hosting if h["site"] == "archive-pilates")
    assert core_host["public"] == "core" and fallback_host["public"] == "."
    mounts = (
        ("https://core.archivepilates.com/", CORE, "/"),
        ("https://archive-pilates.web.app/core/", ROOT, "/core/"),
    )
    pages = sorted(CORE.rglob("*.html"))
    expected_assets = {
        "favicon.ico": ("icon", "image/x-icon", " ".join(f"{s}x{s}" for s in ICO_SIZES)),
        "icons/favicon-16.png": ("icon", "image/png", "16x16"),
        "icons/favicon-32.png": ("icon", "image/png", "32x32"),
        "icons/archive-pilates-icon-192.png": ("icon", "image/png", "192x192"),
        "icons/apple-touch-icon.png": ("apple-touch-icon", None, "180x180"),
        "site.webmanifest": ("manifest", None, None),
    }
    manifest = json.loads((CORE / "site.webmanifest").read_text())
    assert all(manifest[key] == "./" for key in ("id", "start_url", "scope"))
    checks = 0
    for page in pages:
        parser = HeadLinks()
        parser.feed(page.read_text())
        assert len(parser.links) == len(expected_assets), page
        relative = page.relative_to(CORE).as_posix()
        routes = {relative}
        if page.name == "index.html":
            routes.add(relative.removesuffix("index.html"))
        for base, public_root, mount in mounts:
            manifest_url = urljoin(base, "site.webmanifest")
            for item in manifest["icons"]:
                asset = resolve_asset(item["src"], manifest_url, public_root, mount)
                size = int(item["sizes"].split("x")[0])
                verify_png(asset, size)
            for route in sorted(routes):
                document_url = urljoin(base, route) + "?member=test#local-check"
                seen = set()
                for link in parser.links:
                    asset = resolve_asset(link["href"], document_url, public_root, mount)
                    name = asset.relative_to(CORE).as_posix()
                    assert name in expected_assets and name not in seen, (page, name)
                    seen.add(name)
                    rel, mime, sizes = expected_assets[name]
                    assert link["rel"] == rel, page
                    assert link.get("type") == mime and link.get("sizes") == sizes, page
                    checks += 1
    print(f"PASS: ICO frames {dimensions}; PNG signatures/dimensions/pixels/opacity")
    print(f"PASS: official 512px source SHA-256 {SOURCE_SHA256} unchanged")
    print(f"PASS: {len(pages)} HTML heads, {checks} resolved links across both Hosting roots")
    print("PASS: relative manifest icons/start_url/scope/id; rules page included")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate", action="store_true", help="Regenerate bounded favicon assets")
    args = parser.parse_args()
    if args.generate:
        generate()
    check()
