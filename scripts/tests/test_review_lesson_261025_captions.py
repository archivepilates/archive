import importlib.util
import contextlib
import io
import json
from datetime import timedelta
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import srt

spec = importlib.util.spec_from_file_location('review_cd', Path(__file__).parents[1] / 'review-lesson-261025-captions.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class CaptionReviewTests(unittest.TestCase):
    def cue(self, start=0, end=1, index=1, content='호흡을 내쉬세요.'):
        return srt.Subtitle(index, timedelta(seconds=start), timedelta(seconds=end), content)

    def test_only_cd_and_review_limits(self):
        self.assertEqual(review.KEYS, {'c-minjin', 'd-minjin', 'c-eunyeong', 'd-eunyeong'})
        self.assertIn('not a full manual audio audit', review.SCOPE)

    def test_valid_and_source_boundary(self):
        review.validate([self.cue()], 1)
        review.validate([self.cue(), self.cue(1, 2, 2)], 2)

    def test_invalid_sequence_and_bounds(self):
        for cues in [[], [self.cue(-1, 1)], [self.cue(1, 1)], [self.cue(2, 1)],
                     [self.cue(index=2)], [self.cue(content=' ')], [self.cue(end=3)],
                     [self.cue(end=1.1), self.cue(1, 2, 2)]]:
            with self.subTest(cues=cues), self.assertRaises(RuntimeError):
                review.validate(cues, 2)

    def test_invalid_duration(self):
        for duration in [0, -1, float('nan'), float('inf'), '2', None]:
            with self.subTest(duration=duration), self.assertRaises(RuntimeError):
                review.validate([self.cue()], duration)

    def test_private_read_rejects_symlink_and_loose_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'data'
            review.save_new(file, b'private fixture')
            self.assertEqual(review.private_read(file), b'private fixture')
            with self.assertRaises(FileExistsError):
                review.save_new(file, b'replace')
            link = Path(directory) / 'link'
            link.symlink_to(file)
            with self.assertRaises(RuntimeError):
                review.private_read(link)
            file.chmod(0o644)
            with self.assertRaises(RuntimeError):
                review.private_read(file)

    def test_json_agreement_rejects_nonfinite_or_non_numeric_times(self):
        for field in ['start', 'end']:
            for value in [float('nan'), float('inf'), -float('inf'), True, '1', None]:
                segment = {'start': 0, 'end': 1, 'text': '호흡을 내쉬세요.'}
                segment[field] = value
                with self.subTest(field=field, value=value), self.assertRaises(RuntimeError):
                    review.assert_agreement([self.cue()], [segment])

    def fixture(self, directory):
        root = Path(directory)
        folder = root / 'captions' / 'c-minjin'
        folder.mkdir(parents=True)
        review.save_new(root / 'state.json', json.dumps({'videos': {'c-minjin': {
            'source': {'sha256': 'a' * 64, 'duration': 2}}}}).encode())
        review.save_new(folder / 'draft.json', json.dumps({'sourceSha256': 'a' * 64,
            'reviewStatus': 'draft_unreviewed', 'result': {'segments': [
                {'start': 0, 'end': 1, 'text': '뒷꿈치'}]}}).encode())
        review.save_new(folder / 'draft.srt', srt.compose([self.cue(content='뒷꿈치')]).encode())
        return root, folder

    def run_main(self, root, *args):
        with patch.object(review, 'ROOT', root), patch('sys.argv', ['review', *args]), contextlib.redirect_stdout(io.StringIO()):
            review.main()

    def test_prepare_approve_and_replay_preserve_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root, folder = self.fixture(directory)
            self.run_main(root, 'prepare', 'c-minjin')
            data = json.loads((folder / 'review.json').read_bytes())
            self.assertFalse(data['allowedForServing'])
            self.assertEqual(data['orthographicCorrections'], 1)
            self.run_main(root, 'approve', 'c-minjin', '--caption-sha', data['captionSha256'])
            expected = (folder / 'review.json').read_bytes()
            self.run_main(root, 'prepare', 'c-minjin')
            self.run_main(root, 'approve', 'c-minjin', '--caption-sha', data['captionSha256'])
            self.assertEqual((folder / 'review.json').read_bytes(), expected)
            self.assertTrue(json.loads(expected)['allowedForServing'])

    def test_partial_prepare_reuses_only_identical_corrected_file(self):
        for conflict in [False, True]:
            with self.subTest(conflict=conflict), tempfile.TemporaryDirectory() as directory:
                root, folder = self.fixture(directory)
                content = b'conflicting prior evidence' if conflict else srt.compose([self.cue(content='뒤꿈치')]).encode()
                review.save_new(folder / 'corrected.srt', content)
                inode = (folder / 'corrected.srt').stat().st_ino
                if conflict:
                    with self.assertRaises(RuntimeError):
                        self.run_main(root, 'prepare', 'c-minjin')
                    self.assertFalse((folder / 'review.json').exists())
                else:
                    self.run_main(root, 'prepare', 'c-minjin')
                    self.assertTrue((folder / 'review.json').exists())
                self.assertEqual((folder / 'corrected.srt').stat().st_ino, inode)
                self.assertEqual((folder / 'corrected.srt').read_bytes(), content)

    def test_approval_refuses_hash_source_draft_and_caption_drift(self):
        for field in ['argument', 'source', 'draft', 'corrected']:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                root, folder = self.fixture(directory)
                self.run_main(root, 'prepare', 'c-minjin')
                original = (folder / 'review.json').read_bytes()
                caption_hash = json.loads(original)['captionSha256']
                if field == 'argument':
                    caption_hash = 'b' * 64
                elif field == 'source':
                    state = json.loads((root / 'state.json').read_bytes())
                    state['videos']['c-minjin']['source']['sha256'] = 'b' * 64
                    (root / 'state.json').write_text(json.dumps(state))
                else:
                    file = folder / ('draft.srt' if field == 'draft' else 'corrected.srt')
                    file.write_bytes(file.read_bytes() + b'\n')
                with self.assertRaises(RuntimeError):
                    self.run_main(root, 'approve', 'c-minjin', '--caption-sha', caption_hash)
                self.assertEqual((folder / 'review.json').read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
