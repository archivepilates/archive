"""Offline mobile layout geometry; no upload, credentials or browser."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'lib/reel-mobile-layout.py'
spec = importlib.util.spec_from_file_location('layout', path)
layout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)


class FixedFont:
    def getlength(self, text):
        return len(text) * 50


class MobileLayoutTests(unittest.TestCase):
    def test_safe_area_excludes_native_chrome(self):
        self.assertTrue(layout.within_safe((148, 220, 790, 1410)))
        for box in [(148, 100, 700, 150), (148, 1300, 700, 1530), (148, 300, 950, 400)]:
            self.assertFalse(layout.within_safe(box))

    def test_picture_does_not_intersect_caption_or_native_controls(self):
        x, y, w, h = layout.VIDEO
        self.assertGreaterEqual(x, 0)
        self.assertLessEqual(x+w, 900)
        self.assertGreaterEqual(y, 200)
        self.assertLess(y+h, layout.CAPTION[1])

    def test_center_fill_stress_at_phone_aspects(self):
        left, top, right, bottom = layout.SAFE
        for width in (320, 390, 430):
            for ratio in (16/9, 19.5/9, 20/9):
                scale = width * ratio / 1920
                crop_left = (1080 - width/scale) / 2
                self.assertGreaterEqual((left-crop_left)*scale, 0)
                self.assertLessEqual((right-crop_left)*scale, width*.84)
                self.assertGreaterEqual(top*scale, 0)
                self.assertLess(bottom*scale, 1450*scale)
                x, y, w, h = layout.VIDEO
                self.assertGreaterEqual((x-crop_left)*scale, 0)
                self.assertLessEqual((x+w-crop_left)*scale, width*.90)

    def test_render_never_overwrites_existing_review_sidecars(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(layout, 'design') as design:
            path = Path(folder) / 'captions-reviewed.srt'
            path.write_text('approved captions')
            with self.assertRaises(FileExistsError):
                layout.render({}, Path(folder), Path('unused.mp4'))
            design.assert_not_called()
            self.assertEqual(path.read_text(), 'approved captions')

    def test_wrapping_preserves_words_and_explicit_lines(self):
        text = 'one two three\nfour five'
        lines = layout.lines_for(text, FixedFont(), 300)
        self.assertEqual(' '.join(lines), 'one two three four five')
        self.assertTrue(all(FixedFont().getlength(line) <= 300 for line in lines))

    def test_unbreakable_overflow_is_rejected(self):
        with self.assertRaises(ValueError):
            layout.lines_for('unbreakable', FixedFont(), 100)

    def test_actual_design_bounds_when_local_fonts_are_available(self):
        try:
            import PIL
            import srt
        except ImportError:
            self.skipTest('Local media dependencies absent; geometry tests remain active')
        if not layout.FONT.exists():
            self.skipTest('Official local Korean font absent')
        plan = {'hook': ['손목에 기대나요?', '스프링을 줄여 보면'], 'subtitle': '체어 / 정은영',
                'start': 0, 'end': 10, 'cues': [[0, 10, '손목에 기대시는 분들에게\n굉장히 도움 많이 돼요.']]}
        with tempfile.TemporaryDirectory() as folder, patch.object(layout.subprocess, 'run', side_effect=AssertionError('External execution')):
            manifest = layout.design(plan, Path(folder))
            self.assertFalse(manifest['footer'])
            self.assertTrue(all(layout.within_safe(x['bounds']) for x in manifest['labels'] + manifest['captions']))
            plan['cues'] = [[1, 5, 'one'], [4, 8, 'two']]
            with self.assertRaises(AssertionError):
                layout.design(plan, Path(folder))


if __name__ == '__main__':
    unittest.main(verbosity=2)
