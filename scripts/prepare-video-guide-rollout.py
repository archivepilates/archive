#!/usr/bin/env python3
"""Build description-only migration payloads from fresh, reviewed snapshots."""

import json
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts/video-guide-rollout"
TARGETS = list(range(27, 52)) + [79, 80, 84, 85]
CONTACT = "http://pf.kakao.com/_AHdvn/chat"
MARKER = 'data-ap-video-guide="2026-09-13"'
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


@dataclass
class Node:
    tag: str
    attrs: dict
    start: int
    end: int
    parent: object
    text: str = ""
    children: list = field(default_factory=list)


class Document(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.source = source
        self.lines = source.splitlines(keepends=True)
        self.nodes = []
        self.stack = []
        self.feed(source)
        assert not self.stack, "Unclosed source HTML"

    def position(self):
        line, col = self.getpos()
        return sum(map(len, self.lines[:line - 1])) + col

    def handle_starttag(self, tag, attrs):
        start = self.position()
        node = Node(tag, dict(attrs), start, start + len(self.get_starttag_text()), self.stack[-1] if self.stack else None)
        self.nodes.append(node)
        if node.parent:
            node.parent.children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        assert self.stack and self.stack[-1].tag == tag, f"Unexpected closing tag: {tag}"
        node = self.stack.pop()
        node.end = self.source.index(">", self.position()) + 1

    def handle_data(self, text):
        for node in self.stack:
            node.text += text

    def handle_comment(self, text):
        start = self.position()
        node = Node("comment", {}, start, self.source.index("-->", start) + 3, self.stack[-1] if self.stack else None, text.strip())
        self.nodes.append(node)
        if node.parent:
            node.parent.children.append(node)


def one(nodes):
    assert len(nodes) == 1, f"Expected one node, found {len(nodes)}"
    return nodes[0]


def resources(document):
    return [(node.tag, node.attrs.get("href"), node.attrs.get("src"), node.attrs.get("srcset"), node.attrs.get("poster"))
            for node in document.nodes if node.tag in {"a", "img", "iframe", "video", "audio", "source"}]


def guide(product_id):
    sample = (ROOT / "docs/previews/2026-09-13-aca6-use-refund.html").read_text()
    doc = Document(sample)
    css = one([n for n in doc.nodes if n.tag == "style"])
    sample = sample[:css.start] + sample[css.end:]
    sample = sample.replace('data-ap-aca6-guide="2026-09-13"', MARKER)
    if product_id in {79, 80}:
        sample = sample.replace(
            '결제일로부터 7일 이내이며 영상 재생 이력이 없는 경우 <strong>전액 환불</strong>됩니다.',
            '시청 권한 부여 전 또는 영상 재생 이력이 없는 경우 <strong>전액 환불</strong>됩니다.')
        sample = sample.replace('시청 후 또는<br>결제 7일 경과', '시청 후')
    script = (ROOT / "scripts/imweb-video-guide-footer.js").read_text()
    return sample + '\n<script data-ap-video-guide-footer="2026-09-13">\n' + script + '</script>\n'


def transform(product):
    product_id = product["prodNo"]
    assert product_id in TARGETS
    assert product["siteCode"] == "S20260516852c71a014d08"
    assert product["unitCode"] == "u2026051698c99ea234719"
    assert product["prodType"] == "subscribe"
    assert product["useMobileProdContent"] == "N"
    assert product["prodDigitalData"]["subscribeData"]["period"] == 40
    old = product["content"]
    doc = Document(old)
    if MARKER in old:
        expected = Document(guide(product_id))
        actual_section = one([n for n in doc.nodes if n.attrs.get("data-ap-video-guide") == "2026-09-13"])
        actual_script = one([n for n in doc.nodes if n.attrs.get("data-ap-video-guide-footer") == "2026-09-13"])
        expected_section = one([n for n in expected.nodes if n.attrs.get("data-ap-video-guide") == "2026-09-13"])
        expected_script = one([n for n in expected.nodes if n.attrs.get("data-ap-video-guide-footer") == "2026-09-13"])
        assert old[actual_section.start:actual_section.end] == expected.source[expected_section.start:expected_section.end], "Incomplete or stale guide"
        assert actual_script.text == expected_script.text, "Incomplete or stale footer script"
        return old, {"alreadyApplied": True}
    container = one([n for n in doc.nodes if n.tag == "section" and "archive-online-product" in n.attrs.get("class", "").split()])
    policy = one([n for n in container.children if n.attrs.get("data-archive-pilates-tosspay") == "online-2026-07-30"])
    for term in ["40일", "7일", "1/3", "2/3", "1/2", "소비자분쟁해결기준"]:
        assert term in policy.text, f"Unexpected policy for {product_id}: {term}"
    remove = [policy]
    remove += [n for n in container.children if n.tag == "comment" and n.text in {"ARCHIVE_TOSSPAY_POLICY_START", "ARCHIVE_TOSSPAY_POLICY_END"}]
    assert len(remove) == 3
    if product_id == 84:
        # Replace only the approved guide and its immediately preceding stylesheet.
        index = container.children.index(policy)
        css = container.children[index - 1]
        assert css.tag == "style" and "data-ap-aca6-guide" in css.text
        remove.append(css)
        insertion = min(n.start for n in remove)
    else:
        heading = one([n for n in container.children if n.tag == "h3" and n.text.strip() == "구매 후 이용 안내"])
        usage = container.children[container.children.index(heading) + 1]
        assert usage.tag == "ul" and "40일" in usage.text
        contact = one([n for n in container.children if n.tag == "a" and n.attrs.get("href") == CONTACT])
        remove += [heading, usage, contact]
        insertion = heading.start
        extra = [n for n in container.children if any(c.tag == "h3" and c.text == "서비스 제공기간 및 환불규정" for c in n.children)]
        if product_id in {79, 80}:
            assert len(extra) == 1
            assert "시청 권한 부여 전 또는 시청 이력이 없는 경우 전액 환불 가능합니다." in extra[0].text
            remove += extra
        else:
            assert not extra, "Unreviewed extra refund terms"
    ranges = sorted((node.start, node.end) for node in remove)
    assert all(end <= next_start for (_, end), (next_start, _) in zip(ranges, ranges[1:]))
    result = []
    cursor = 0
    for start, end in ranges:
        result.append(old[cursor:start])
        if start == insertion:
            result.append(guide(product_id))
        cursor = end
    result.append(old[cursor:])
    updated = "".join(result)
    after = Document(updated)
    assert resources(doc) == resources(after), "Media or destination changed"
    assert len([n for n in after.nodes if n.attrs.get("data-ap-video-guide") == "2026-09-13"]) == 1
    assert "안내·계약과" not in updated
    assert "구매 후 이용 안내" not in updated
    assert "서비스 제공기간 및 환불규정" not in updated
    assert updated.count('<details ') == 1
    assert updated.count(CONTACT) == 1
    return updated, {"alreadyApplied": False, "replacedNodes": len(ranges), "preservedOutsideRanges": True,
                     "mediaAndLinksUnchanged": True, "preservedBroaderUnplayedRefund": product_id in {79, 80}}


def main():
    output = ARTIFACTS / "payloads"
    output.mkdir(parents=True, exist_ok=True)
    plan = []
    for product_id in TARGETS:
        product = json.loads((ARTIFACTS / "before" / f"{product_id}.json").read_text())["data"]
        description, proof = transform(product)
        payload = {"description": description, "unitCode": product["unitCode"]}
        (output / f"{product_id}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        plan.append({"id": product_id, "name": product["name"], "status": product["prodStatus"],
                     "url": f"https://archivepilates.imweb.me/17/?idx={product_id}", **proof})
    (ARTIFACTS / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2))
    print(json.dumps({"targetCount": len(plan), "targets": [p["id"] for p in plan], "prepared": True}))


if __name__ == "__main__":
    main()
