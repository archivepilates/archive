#!/usr/bin/env python3
"""Offline checks for native footer migration; never writes to Imweb."""

import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("native_guide", ROOT / "scripts/prepare-native-video-guide.py")
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def product(product_id):
    return json.loads((native.ARTIFACTS / 'before' / f'{product_id}.json').read_text())['data']


class NativeGuideTests(unittest.TestCase):
    def test_all_current_source_variants(self):
        for product_id in native.base.TARGETS:
            source = product(product_id)
            unchanged = copy.deepcopy(source)
            cleaned, proof = native.strip_individual_guide(source)
            self.assertEqual(source, unchanged)
            self.assertNotIn('<script', cleaned)
            self.assertNotIn('data-ap-duplicate-legal', cleaned)
            self.assertTrue(proof['outsideBytesPreserved'])
            self.assertTrue(proof['mediaAndWatchLinksUnchanged'])
            self.assertEqual(sum(n.tag == 'h2' for n in native.base.Document(cleaned).nodes), 1)

    def test_unknown_material_survives_every_layout(self):
        extra = '<aside><p>Keep this unique notice.</p><video poster="unique.png"><source src="unique.mp4"></video><a href="https://example.com/notes">Notes</a><section><h3>More information</h3></section></aside>'
        for product_id in [27, 34, 79, 84, 85]:
            source = product(product_id)
            position = source['content'].rindex('</section>')
            source['content'] = source['content'][:position] + extra + source['content'][position:]
            cleaned, _ = native.strip_individual_guide(source)
            self.assertIn(extra, cleaned)
            self.assertTrue(cleaned.rstrip().endswith(extra + '</section>'))

    def test_refund_variants_and_contact(self):
        for variant in ['standard', 'unplayed']:
            html = native.footer(variant)
            doc = native.base.Document(html)
            self.assertEqual([n.text for n in doc.nodes if n.tag == 'h3'], ['이용 안내', '환불 안내'])
            self.assertEqual(sum(n.tag == 'details' for n in doc.nodes), 1)
            self.assertEqual(html.count(native.base.CONTACT), 1)
            self.assertNotIn('<script', html)
            self.assertNotIn('<style', html)
            for term in ['40일', '7일', '1/3', '2/3', '1/2', '3개월', '30일', '소비자분쟁해결기준']:
                self.assertIn(term, html)
        self.assertIn('시청 권한 부여 전 또는 영상 재생 이력이 없는 경우', native.footer('unplayed'))
        self.assertNotIn('결제 7일 경과', native.footer('unplayed'))

    def test_missing_boundary_and_wrong_product_stop(self):
        for product_id in [27, 34, 79, 84, 85]:
            source = product(product_id)
            source['content'] = source['content'].replace('data-archive-pilates-tosspay', 'unknown-policy')
            with self.assertRaises(AssertionError):
                native.strip_individual_guide(source)
        source = product(85)
        source['prodNo'] = 1
        with self.assertRaises(AssertionError):
            native.strip_individual_guide(source)


if __name__ == '__main__':
    unittest.main()
