#!/usr/bin/env python3
"""Prepare native common-footer HTML and bounded removal of duplicated copy."""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("video_guide", ROOT / "scripts/prepare-video-guide-rollout.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
ARTIFACTS = ROOT / "artifacts/native-video-guide"
TEMPLATE_DIR = ROOT / "docs/previews"


def footer(variant):
    html = (TEMPLATE_DIR / "2026-09-13-aca6-use-refund.html").read_text()
    doc = base.Document(html)
    node = base.one([n for n in doc.nodes if n.attrs.get("data-ap-aca6-guide")])
    html = html[node.start:node.end].replace('data-ap-aca6-guide="2026-09-13"', f'data-ap-native-video-guide="{variant}-2026-09-13"')
    if variant == "unplayed":
        html = html.replace('결제일로부터 7일 이내이며 영상 재생 이력이 없는 경우 <strong>전액 환불</strong>됩니다.',
                            '시청 권한 부여 전 또는 영상 재생 이력이 없는 경우 <strong>전액 환불</strong>됩니다.')
        html = html.replace('시청 후 또는<br>결제 7일 경과', '시청 후')
    assert "<script" not in html and "<style" not in html
    return html


def strip_individual_guide(product):
    product_id = product["prodNo"]
    assert product_id in base.TARGETS
    assert product["siteCode"] == "S20260516852c71a014d08"
    assert product["prodType"] == "subscribe"
    assert product["useMobileProdContent"] == "N"
    assert product["prodDigitalData"]["subscribeData"]["period"] == 40
    old = product["content"]
    doc = base.Document(old)
    container = base.one([n for n in doc.nodes if n.tag == "section" and "archive-online-product" in n.attrs.get("class", "").split()])
    policy = base.one([n for n in container.children if n.attrs.get("data-archive-pilates-tosspay") == "online-2026-07-30"])
    for term in ["40일", "7일", "1/3", "2/3", "1/2", "소비자분쟁해결기준"]:
        assert term in policy.text, f"Unrecognized policy: {product_id} {term}"
    remove = [policy] + [n for n in container.children if n.tag == "comment" and n.text in {"ARCHIVE_TOSSPAY_POLICY_START", "ARCHIVE_TOSSPAY_POLICY_END"}]
    assert len(remove) == 3
    if policy.attrs.get("data-ap-video-guide"):
        script = base.one([n for n in container.children if n.attrs.get("data-ap-video-guide-footer") == "2026-09-13"])
        assert "__apVideoGuideFooter20260913" in script.text
        remove.append(script)
    elif policy.attrs.get("data-ap-aca6-guide"):
        css = container.children[container.children.index(policy) - 1]
        assert css.tag == "style" and 'data-ap-aca6-guide' in css.text
        remove.append(css)
    else:
        heading = base.one([n for n in container.children if n.tag == "h3" and n.text.strip() == "구매 후 이용 안내"])
        usage = container.children[container.children.index(heading) + 1]
        assert usage.tag == "ul" and "40일" in usage.text
        contact = base.one([n for n in container.children if n.tag == "a" and n.attrs.get("href") == base.CONTACT])
        remove += [heading, usage, contact]
        extra = [n for n in container.children if any(c.tag == "h3" and c.text == "서비스 제공기간 및 환불규정" for c in n.children)]
        if product_id in {79, 80}:
            assert len(extra) == 1 and '시청 권한 부여 전 또는 시청 이력이 없는 경우 전액 환불 가능합니다.' in extra[0].text
            remove += extra
        else:
            assert not extra
    ranges = sorted((n.start, n.end) for n in remove)
    assert all(end <= next_start for (_, end), (next_start, _) in zip(ranges, ranges[1:]))
    cursor, chunks = 0, []
    for start, end in ranges:
        chunks.append(old[cursor:start])
        cursor = end
    chunks.append(old[cursor:])
    cleaned = ''.join(chunks)
    after = base.Document(cleaned)
    before_resources = base.resources(doc)
    after_resources = base.resources(after)
    assert before_resources.count(('a', base.CONTACT, None, None, None)) == 1
    assert [r for r in before_resources if r[1] != base.CONTACT] == after_resources
    for text in ['구매 후 이용 안내', 'ARCHIVE_TOSSPAY_POLICY', 'data-ap-video-guide', 'data-ap-aca6-guide', '이용 안내</h3>', '환불 안내</h3>', '서비스 제공기간 및 환불규정']:
        assert text not in cleaned, text
    return cleaned, {"removedNodes": len(remove), "outsideBytesPreserved": True, "mediaAndWatchLinksUnchanged": True,
                     "contactMovedToFooter": True}


def main():
    output = ARTIFACTS / "cleaned"
    output.mkdir(parents=True, exist_ok=True)
    for variant in ["standard", "unplayed"]:
        (ARTIFACTS / f"footer-{variant}.html").write_text(footer(variant))
    plan = []
    for product_id in base.TARGETS:
        product = json.loads((ARTIFACTS / "before" / f"{product_id}.json").read_text())["data"]
        description, proof = strip_individual_guide(product)
        (output / f"{product_id}.json").write_text(json.dumps({"description": description, "unitCode": product["unitCode"]}, ensure_ascii=False, indent=2))
        plan.append({"id": product_id, "name": product["name"], "status": product["prodStatus"],
                     "variant": "unplayed" if product_id in {79, 80} else "standard", **proof})
    (ARTIFACTS / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2))
    print(json.dumps({"prepared": len(plan), "variants": 2, "nativeCreationPending": True}))


if __name__ == "__main__":
    main()
