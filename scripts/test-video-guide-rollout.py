#!/usr/bin/env python3
"""Focused, offline regression tests for the approved description migration."""

import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("rollout", ROOT / "scripts/prepare-video-guide-rollout.py")
rollout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rollout)


def product(product_id=85):
    return json.loads((rollout.ARTIFACTS / "before" / f"{product_id}.json").read_text())["data"]


class GuideTests(unittest.TestCase):
    def test_catalogue_and_idempotence(self):
        for product_id in rollout.TARGETS:
            source = product(product_id)
            original = copy.deepcopy(source)
            html, proof = rollout.transform(source)
            self.assertEqual(source, original)
            again = dict(source, content=html)
            self.assertEqual(rollout.transform(again)[0], html)
            self.assertTrue(proof["mediaAndLinksUnchanged"])

    def test_unrelated_trailing_content_is_untouched(self):
        source = product()
        extra = '<aside><h3>Additional curriculum</h3><p>Keep this text.</p><video poster="poster.png"><source src="clip.mp4"></video><a href="https://example.com/notes">Notes</a><section><p>Nested material</p></section></aside>'
        index = source["content"].rindex("</section>")
        source["content"] = source["content"][:index] + extra + source["content"][index:]
        changed, _ = rollout.transform(source)
        self.assertIn(extra, changed)
        self.assertTrue(changed.rstrip().endswith(extra + '</section>'))

    def test_incompatible_sources_stop(self):
        for field, value in [("prodNo", 1), ("prodType", "normal"), ("useMobileProdContent", "Y")]:
            source = product()
            source[field] = value
            with self.assertRaises(AssertionError):
                rollout.transform(source)
        source = product()
        source["prodDigitalData"]["subscribeData"]["period"] = 30
        with self.assertRaises(AssertionError):
            rollout.transform(source)

    def test_ambiguous_boundaries_stop(self):
        source = product()
        source["content"] = source["content"].replace('구매 후 이용 안내', 'Changed heading')
        with self.assertRaises(AssertionError):
            rollout.transform(source)
        source = product()
        source["content"] = source["content"].replace('구매 후 이용 안내</h3>', '구매 후 이용 안내</h3><h3>구매 후 이용 안내</h3>')
        with self.assertRaises(AssertionError):
            rollout.transform(source)

    def test_broader_refund_is_preserved(self):
        for product_id in (79, 80):
            html, proof = rollout.transform(product(product_id))
            self.assertIn('시청 권한 부여 전 또는 영상 재생 이력이 없는 경우', html)
            self.assertNotIn('시청 후 또는<br>결제 7일 경과', html)
            self.assertTrue(proof['preservedBroaderUnplayedRefund'])

    def test_incomplete_applied_marker_is_rejected(self):
        source = product()
        html, _ = rollout.transform(source)
        doc = rollout.Document(html)
        script = rollout.one([n for n in doc.nodes if n.tag == 'script'])
        section = rollout.one([n for n in doc.nodes if n.attrs.get('data-ap-video-guide')])
        broken = [
            html[script.start:script.end],
            html[:script.start] + html[script.end:],
            html[:section.start] + html[section.end:],
            html + html[section.start:section.end],
            html.replace('__apVideoGuideFooter20260913', '__apVideoGuideFooterOLD'),
        ]
        for content in broken:
            with self.assertRaises(AssertionError):
                rollout.transform(dict(source, content=content))


if __name__ == '__main__':
    unittest.main()
