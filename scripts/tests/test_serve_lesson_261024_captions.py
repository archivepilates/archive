"""Source-extracted caption protocol tests; never import or invoke a CLI."""

import ast
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest import mock


SOURCE = Path(__file__).resolve().parents[1] / 'serve-lesson-261024-captions.py'
TREE = ast.parse(SOURCE.read_text(encoding='utf-8'), filename=str(SOURCE))
CHANNEL = 'fixture-channel'
VIDEO_ID = 'fixture0001'
CAPTION_ID = 'fixture-caption'
CAPTION_BYTES = b'1\n00:00:00,000 --> 00:00:01,000\nSynthetic reviewed caption.\n'
CHANGED_BYTES = b'1\n00:00:00,000 --> 00:00:01,000\nUnapproved changed caption.\n'
CAPTION_HASH = hashlib.sha256(CAPTION_BYTES).hexdigest()
SOURCE_HASH = 'b' * 64
TRACK_NAME = '\ud55c\uad6d\uc5b4 \u00b7 \uac15\uc0ac\ub808\uc2a8 \uc790\ub9c9'
REVIEW_SCOPE = 'terminology-corrected and timestamp-validated; not a full manual audio audit'
JAPANESE = {'title': 'Fixture JA', 'description': 'Fixture Japanese description'}


def extract_function(name, namespace):
    node = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == name)
    exec(compile(ast.Module(body=[copy.deepcopy(node)], type_ignores=[]), str(SOURCE), 'exec'), namespace)
    return namespace[name]


def extract_flow(namespace):
    main = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
    block = next(node for node in main.body if isinstance(node, ast.With)).body
    gate = next(node for node in block if isinstance(node, ast.If) and any(
        isinstance(item, ast.Constant) and item.value == 'caption_review_required'
        for item in ast.walk(node)
    ))
    start = next(index for index, node in enumerate(block)
                 if isinstance(node, ast.FunctionDef) and node.name == 'read')
    wrapper = ast.parse('def offline_flow(youtube, row, state, review, caption_file, args):\n    pass').body[0]
    # Preserve the actual review gate and protocol body, excluding parser/auth/disk setup.
    wrapper.body = [copy.deepcopy(gate), *copy.deepcopy(block[start:])]
    module = ast.fix_missing_locations(ast.Module(body=[wrapper], type_ignores=[]))
    exec(compile(module, str(SOURCE), 'exec'), namespace)
    return namespace['offline_flow']


class CaptionServingTests(unittest.TestCase):
    def setUp(self):
        for guard in (
            mock.patch('builtins.open', side_effect=AssertionError('Disk forbidden')),
            mock.patch.object(io, 'open', side_effect=AssertionError('Disk forbidden')),
            mock.patch.object(Path, 'open', side_effect=AssertionError('Disk forbidden')),
            mock.patch.object(os, 'open', side_effect=AssertionError('Disk forbidden')),
            mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')),
            mock.patch.object(socket.socket, 'connect_ex', side_effect=AssertionError('Network forbidden')),
            mock.patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')),
            mock.patch.object(subprocess, 'Popen', side_effect=AssertionError('Processes forbidden')),
        ):
            self.enterContext(guard)
        self.output = self.enterContext(mock.patch.object(sys, 'stdout', new=io.StringIO()))
        self.youtube = mock.Mock(spec=['videos', 'captions'])
        self.videos = mock.Mock(spec=['list', 'update'])
        self.captions = mock.Mock(spec=['list', 'insert'])
        self.youtube.videos.return_value = self.videos
        self.youtube.captions.return_value = self.captions
        self.video_read = mock.Mock(spec=['execute'])
        self.video_update = mock.Mock(spec=['execute'])
        self.caption_read = mock.Mock(spec=['execute'])
        self.caption_insert = mock.Mock(spec=['execute'])
        self.videos.list.return_value = self.video_read
        self.videos.update.return_value = self.video_update
        self.captions.list.return_value = self.caption_read
        self.captions.insert.return_value = self.caption_insert
        self.clock = mock.Mock(return_value=1234567890.5)
        self.sleep = mock.Mock()
        self.save = mock.Mock(side_effect=self.persist)
        self.media = mock.Mock(side_effect=self.capture_media)
        self.namespace = {'lesson': SimpleNamespace(CHANNEL=CHANNEL, save=self.save),
                          'MediaIoBaseUpload': self.media, 'BytesIO': io.BytesIO, 'hashlib': hashlib,
                          'time': SimpleNamespace(time=self.clock, sleep=self.sleep),
                          'japanese': mock.Mock(return_value=copy.deepcopy(JAPANESE)), 'json': json}
        self.sha_implementation = extract_function('sha', self.namespace)
        self.sha = mock.Mock(side_effect=self.sha_implementation)
        self.namespace['sha'] = self.sha
        extract_function('localization_readback_matches', self.namespace)
        self.flow = extract_flow(self.namespace)
        self.reset_case()

    def reset_case(self):
        self.row = {'youtubeId': VIDEO_ID, 'source': {'sha256': SOURCE_HASH},
                    'snippet': {'title': 'Fixture KO', 'description': 'Original Korean metadata',
                                'categoryId': '27', 'tags': ['zeta', 'alpha'],
                                'defaultLanguage': 'ko', 'defaultAudioLanguage': 'ko'}}
        self.state = {'videos': {'a-minjin': self.row}}
        self.review = {'allowedForServing': True, 'sourceSha256': SOURCE_HASH,
                       'captionSha256': CAPTION_HASH, 'reviewScope': REVIEW_SCOPE}
        self.current = {'id': VIDEO_ID, 'snippet': {**copy.deepcopy(self.row['snippet']), 'channelId': CHANNEL},
                        'status': {'privacyStatus': 'unlisted'},
                        'localizations': {'ko': {'title': 'Original KO', 'description': 'Preserve KO'},
                                          'fr': {'title': 'Original FR', 'description': 'Preserve FR'}}}
        self.tracks = []
        self.events = []
        self.saved = []
        self.file_bytes = CAPTION_BYTES
        self.caption_file = mock.Mock(spec=['read_bytes'])
        self.caption_file.read_bytes.side_effect = lambda: self.file_bytes
        self.media_stream = None
        for value in (self.save, self.media, self.sleep, self.sha, self.videos, self.captions,
                      self.video_read, self.video_update, self.caption_read, self.caption_insert):
            value.reset_mock()
        self.save.side_effect = self.persist
        self.sha.side_effect = self.sha_implementation
        self.media.side_effect = self.capture_media
        self.video_read.execute.side_effect = self.read_video
        self.video_update.execute.side_effect = self.update_localizations
        self.caption_read.execute.side_effect = self.read_captions
        self.caption_insert.execute.side_effect = self.insert_caption
        self.output.seek(0)
        self.output.truncate()

    def track(self, caption_id=CAPTION_ID, **snippet):
        return {'id': caption_id, 'snippet': {'name': TRACK_NAME, 'language': 'ko',
                'isDraft': False, 'status': 'serving', **snippet}}

    def persist(self, state):
        self.assertIs(state, self.state)
        self.saved.append(copy.deepcopy(state))
        self.events.append('save')

    def read_video(self):
        self.events.append('video_read')
        self.assertEqual(self.videos.list.call_args, mock.call(part='snippet,status,localizations', id=VIDEO_ID))
        return {'items': [copy.deepcopy(self.current)]}

    def read_captions(self):
        self.events.append('caption_read')
        args = self.captions.list.call_args.kwargs
        self.assertEqual(args['videoId'], VIDEO_ID)
        self.assertEqual(args['part'], 'snippet')
        rows = [track for track in self.tracks if 'id' not in args or track['id'] == args['id']]
        return {'items': copy.deepcopy(rows)}

    def insert_caption(self):
        durable = self.saved[-1]['videos']['a-minjin']
        self.assertIn('captionInsertIntentAt', durable)
        self.assertEqual(durable['captionFileSha256'], CAPTION_HASH)
        self.assertEqual(self.captions.insert.call_args.kwargs['body'], {'snippet': {
            'videoId': VIDEO_ID, 'language': 'ko', 'name': TRACK_NAME, 'isDraft': False,
        }})
        self.assertIs(self.captions.insert.call_args.kwargs['media_body'].stream, self.media_stream)
        self.assertEqual(self.media_stream.getvalue(), CAPTION_BYTES)
        self.events.append('insert')
        self.tracks = [self.track()]
        return copy.deepcopy(self.tracks[0])

    def capture_media(self, stream, *, mimetype):
        self.assertIsInstance(stream, io.BytesIO)
        self.assertEqual(stream.getvalue(), CAPTION_BYTES)
        self.assertEqual(mimetype, 'application/octet-stream')
        self.media_stream = stream
        return SimpleNamespace(stream=stream, mimetype=mimetype)

    def update_localizations(self):
        durable = self.saved[-1]['videos']['a-minjin']
        self.assertEqual(durable['captionStatus'], 'serving')
        self.assertEqual(durable['captionReview'], REVIEW_SCOPE)
        self.assertIn('japaneseIntentAt', durable)
        self.assertEqual(self.videos.update.call_args.kwargs['part'], 'localizations')
        body = self.videos.update.call_args.kwargs['body']
        self.assertEqual(body['id'], VIDEO_ID)
        self.current['localizations'] = copy.deepcopy(body['localizations'])
        self.events.append('localizations_update')
        return {'id': VIDEO_ID}

    def serve(self):
        self.flow(self.youtube, self.row, self.state, self.review,
                  self.caption_file, SimpleNamespace(key='a-minjin'))

    def owned_track(self):
        self.tracks = [self.track()]
        self.row.update(captionFileSha256=CAPTION_HASH, captionId=CAPTION_ID,
                        captionInsertIntentAt=1234567800.0)

    def test_approved_corrected_srt_serves_before_japanese_and_preserves_other_metadata(self):
        original = copy.deepcopy(self.current)
        self.serve()
        self.assertLess(self.events.index('insert'), self.events.index('localizations_update'))
        self.assertEqual(self.row['captionStatus'], 'serving')
        self.assertEqual(self.row['captionReview'], REVIEW_SCOPE)
        self.assertEqual(self.current['snippet'], original['snippet'])
        self.assertEqual(self.current['status'], {'privacyStatus': 'unlisted'})
        self.assertEqual(self.current['localizations'], {**original['localizations'], 'ja': JAPANESE})
        self.media.assert_called_once_with(self.media_stream, mimetype='application/octet-stream')
        self.assertIsInstance(self.media_stream, io.BytesIO)
        self.assertEqual(self.media_stream.getvalue(), CAPTION_BYTES)
        self.assertEqual(self.caption_file.read_bytes.call_count, 3)
        self.assertEqual(json.loads(self.output.getvalue())['reviewScope'], REVIEW_SCOPE)

    def test_missing_approval_or_hash_mismatch_blocks_all_provider_activity(self):
        for field, value in (('allowedForServing', False), ('allowedForServing', 'true'),
                             ('sourceSha256', 'changed'), ('captionSha256', 'changed')):
            with self.subTest(field=field, value=value):
                self.reset_case()
                self.review[field] = value
                with self.assertRaisesRegex(RuntimeError, '^caption_review_required$'):
                    self.serve()
                self.videos.list.assert_not_called()
                self.captions.insert.assert_not_called()
                self.videos.update.assert_not_called()
                self.save.assert_not_called()

    def test_original_metadata_channel_and_visibility_changes_block_caption_insert(self):
        for section, field, value in (('snippet', 'title', 'changed'), ('snippet', 'description', 'changed'),
                                     ('snippet', 'defaultLanguage', 'ja'), ('snippet', 'defaultAudioLanguage', 'ja'),
                                     ('snippet', 'categoryId', '99'), ('snippet', 'tags', ['changed']),
                                     ('snippet', 'channelId', 'other-channel'), ('status', 'privacyStatus', 'public')):
            with self.subTest(field=field):
                self.reset_case()
                self.current[section][field] = value
                with self.assertRaises(RuntimeError):
                    self.serve()
                self.captions.insert.assert_not_called()
                self.videos.update.assert_not_called()
                self.save.assert_not_called()

    def test_insert_intent_persistence_failure_prevents_insert(self):
        self.save.side_effect = OSError('fixture disk failure')
        with self.assertRaises(OSError):
            self.serve()
        self.captions.insert.assert_not_called()
        self.videos.update.assert_not_called()

    def test_caption_changed_after_approval_check_cannot_be_inserted(self):
        self.caption_file.read_bytes.side_effect = [CAPTION_BYTES, CHANGED_BYTES]
        with self.assertRaisesRegex(RuntimeError, '^caption_changed_after_review$'):
            self.serve()
        self.assertEqual(self.caption_file.read_bytes.call_count, 2)
        self.media.assert_not_called()
        self.captions.insert.assert_not_called()
        self.videos.update.assert_not_called()
        self.save.assert_not_called()

    def test_caption_changed_between_second_hash_and_byte_capture_is_rejected(self):
        self.caption_file.read_bytes.side_effect = [CAPTION_BYTES, CAPTION_BYTES, CHANGED_BYTES]
        with self.assertRaisesRegex(RuntimeError, '^caption_changed_after_review$'):
            self.serve()
        self.assertEqual(self.caption_file.read_bytes.call_count, 3)
        self.media.assert_not_called()
        self.captions.insert.assert_not_called()
        self.videos.update.assert_not_called()
        self.save.assert_not_called()

    def test_path_mutation_after_capture_cannot_change_the_uploaded_bytes(self):
        def mutate_path_after_capture(stream, *, mimetype):
            media = self.capture_media(stream, mimetype=mimetype)
            self.file_bytes = CHANGED_BYTES
            return media

        self.media.side_effect = mutate_path_after_capture
        self.serve()
        self.assertEqual(self.caption_file.read_bytes.call_count, 3)
        self.assertEqual(self.caption_file.read_bytes(), CHANGED_BYTES)
        self.assertEqual(self.media_stream.getvalue(), CAPTION_BYTES)
        self.assertEqual(hashlib.sha256(self.media_stream.getvalue()).hexdigest(), self.review['captionSha256'])
        self.assertEqual(self.row['captionFileSha256'], CAPTION_HASH)
        self.assertEqual(self.row['captionStatus'], 'serving')
        self.captions.insert.assert_called_once()

    def test_unknown_insert_without_visible_track_cannot_be_replayed(self):
        self.caption_insert.execute.side_effect = ConnectionError('fixture lost insert response')
        with self.assertRaises(ConnectionError):
            self.serve()
        self.assertIn('captionInsertIntentAt', self.saved[-1]['videos']['a-minjin'])
        with self.assertRaisesRegex(RuntimeError, '^prior_caption_insert_uncertain_no_retry$'):
            self.serve()
        self.captions.insert.assert_called_once()
        self.videos.update.assert_not_called()
        self.assertEqual(self.output.getvalue(), '')

    def test_duplicate_named_tracks_and_unowned_file_hash_block_all_writes(self):
        for duplicate in (False, True):
            with self.subTest(duplicate=duplicate):
                self.reset_case()
                self.tracks = [self.track()]
                if duplicate:
                    self.tracks.append(self.track('other-track'))
                with self.assertRaisesRegex(RuntimeError,
                        '^duplicate_caption_track_review_required$' if duplicate else '^existing_caption_hash_not_owned$'):
                    self.serve()
                self.captions.insert.assert_not_called()
                self.videos.update.assert_not_called()

    def test_known_owned_track_recovers_without_a_second_insert(self):
        self.owned_track()
        self.serve()
        self.captions.insert.assert_not_called()
        self.assertEqual(self.row['captionId'], CAPTION_ID)
        self.assertIn('japaneseVerifiedAt', self.row)

    def test_same_name_different_id_cannot_replace_a_previously_owned_caption(self):
        self.owned_track()
        self.tracks = [self.track('unrelated-track')]
        with self.assertRaisesRegex(RuntimeError, '^existing_caption_identity_not_owned$'):
            self.serve()
        self.assertEqual(self.row['captionId'], CAPTION_ID)
        self.videos.update.assert_not_called()

    def test_insert_unknown_cannot_claim_an_unbound_same_name_track_as_corrected_content(self):
        self.row.update(captionInsertIntentAt=1234567800.0, captionFileSha256=CAPTION_HASH)
        self.tracks = [self.track('unproven-track')]
        with self.assertRaisesRegex(RuntimeError, '^existing_caption_identity_not_owned$'):
            self.serve()
        self.videos.update.assert_not_called()
        self.assertNotIn('japaneseVerifiedAt', self.row)

    def test_matching_owned_id_does_not_bypass_caption_hash_ownership(self):
        self.owned_track()
        self.row['captionFileSha256'] = 'different-approved-file'
        with self.assertRaisesRegex(RuntimeError, '^existing_caption_hash_not_owned$'):
            self.serve()
        self.captions.insert.assert_not_called()
        self.videos.update.assert_not_called()
        self.save.assert_not_called()

    def test_lost_caption_id_checkpoint_requires_reconciliation_without_a_second_insert(self):
        def fail_caption_id_save(state):
            if 'captionId' in self.row:
                raise OSError('fixture lost caption ID checkpoint')
            self.persist(state)

        self.save.side_effect = fail_caption_id_save
        with self.assertRaises(OSError):
            self.serve()
        self.assertEqual(len(self.saved), 1)
        self.state = copy.deepcopy(self.saved[0])
        self.row = self.state['videos']['a-minjin']
        self.save.side_effect = self.persist
        with self.assertRaisesRegex(RuntimeError, '^existing_caption_identity_not_owned$'):
            self.serve()
        self.captions.insert.assert_called_once()
        self.videos.update.assert_not_called()

    def test_failed_foreign_or_draft_captions_never_unlock_japanese(self):
        for changes in ({'status': 'failed'}, {'language': 'ja'}, {'isDraft': True}):
            with self.subTest(changes=changes):
                self.reset_case()
                self.owned_track()
                self.tracks = [self.track(**changes)]
                with self.assertRaises(RuntimeError):
                    self.serve()
                self.videos.update.assert_not_called()
                self.assertNotIn('japaneseIntentAt', self.row)

    def test_processing_wait_is_bounded_and_timeout_never_writes_japanese(self):
        self.owned_track()
        self.tracks = [self.track(status='syncing')]
        with self.assertRaisesRegex(RuntimeError, '^caption_still_processing_resume_read_only_first$'):
            self.serve()
        self.assertEqual(self.caption_read.execute.call_count, 21)
        self.assertEqual(self.sleep.call_count, 20)
        self.assertTrue(all(call == mock.call(15) for call in self.sleep.call_args_list))
        self.videos.update.assert_not_called()

    def test_prior_unknown_japanese_intent_with_missing_translation_blocks_retry(self):
        self.owned_track()
        self.row['japaneseIntentAt'] = 1234567800.0
        with self.assertRaisesRegex(RuntimeError, '^japanese_result_unknown_no_automatic_retry$'):
            self.serve()
        self.videos.update.assert_not_called()

    def test_existing_expected_japanese_reconciles_without_another_update(self):
        self.owned_track()
        self.row['japaneseIntentAt'] = 1234567800.0
        self.current['localizations']['ja'] = copy.deepcopy(JAPANESE)
        before = copy.deepcopy(self.current)
        self.serve()
        self.videos.update.assert_not_called()
        self.assertEqual(self.current, before)
        self.assertIn('japaneseVerifiedAt', self.row)

    def test_conflicting_existing_japanese_is_preserved_not_overwritten(self):
        self.owned_track()
        self.current['localizations']['ja'] = {'title': 'Existing JA', 'description': 'Preserve this'}
        before = copy.deepcopy(self.current)
        with self.assertRaisesRegex(RuntimeError, '^existing_japanese_metadata_preserved_review_required$'):
            self.serve()
        self.videos.update.assert_not_called()
        self.assertEqual(self.current, before)

    def test_ambiguous_japanese_update_never_repeats_without_readback(self):
        self.owned_track()
        self.video_update.execute.side_effect = ConnectionError('fixture unknown localization result')
        with self.assertRaises(ConnectionError):
            self.serve()
        self.assertIn('japaneseIntentAt', self.saved[-1]['videos']['a-minjin'])
        with self.assertRaisesRegex(RuntimeError, '^japanese_result_unknown_no_automatic_retry$'):
            self.serve()
        self.videos.update.assert_called_once()
        self.assertEqual(self.output.getvalue(), '')

    def test_accepted_japanese_update_with_lost_response_reconciles_without_replay(self):
        self.owned_track()
        original_languages = copy.deepcopy(self.current['localizations'])

        def accepted_with_lost_response():
            self.update_localizations()
            raise ConnectionError('fixture accepted localization update with lost response')

        self.video_update.execute.side_effect = accepted_with_lost_response
        with self.assertRaises(ConnectionError):
            self.serve()
        self.assertNotIn('japaneseVerifiedAt', self.row)
        self.serve()
        self.videos.update.assert_called_once()
        self.assertIn('japaneseVerifiedAt', self.row)
        self.assertEqual(self.current['localizations'], {**original_languages, 'ja': JAPANESE})

    def test_japanese_intent_persistence_failure_blocks_provider_update(self):
        self.owned_track()

        def fail_japanese_intent_save(state):
            if 'japaneseIntentAt' in self.row:
                raise OSError('fixture Japanese intent persistence failure')
            self.persist(state)

        self.save.side_effect = fail_japanese_intent_save
        with self.assertRaises(OSError):
            self.serve()
        self.videos.update.assert_not_called()
        self.assertNotIn('japaneseVerifiedAt', self.row)
        self.assertEqual(self.output.getvalue(), '')

    def test_final_localization_readback_requires_every_original_language(self):
        self.owned_track()

        def lose_original_language():
            self.update_localizations()
            del self.current['localizations']['ko']

        self.video_update.execute.side_effect = lose_original_language
        with self.assertRaisesRegex(RuntimeError, '^localized_metadata_readback_failed$'):
            self.serve()
        self.assertNotIn('japaneseVerifiedAt', self.row)
        self.assertEqual(self.output.getvalue(), '')
        self.videos.update.assert_called_once()
        self.assertEqual(self.videos.list.call_count, 7)
        self.assertEqual(self.sleep.call_args_list, [mock.call(2)] * 4)

    def test_stale_localization_readbacks_retry_reads_only_until_exact_match(self):
        for stale_reads in (1, 4):
            with self.subTest(stale_reads=stale_reads):
                self.reset_case()
                self.owned_track()
                stale = copy.deepcopy(self.current)
                attempts = 0

                def eventual_readback():
                    nonlocal attempts
                    result = self.read_video()
                    if self.video_update.execute.call_count:
                        attempts += 1
                        if attempts <= stale_reads:
                            return {'items': [copy.deepcopy(stale)]}
                    return result

                self.video_read.execute.side_effect = eventual_readback
                self.serve()
                self.assertEqual(attempts, stale_reads + 1)
                self.assertEqual(self.videos.list.call_count, stale_reads + 3)
                self.assertEqual(self.sleep.call_args_list, [mock.call(2)] * stale_reads)
                self.videos.update.assert_called_once()
                self.assertIn('japaneseVerifiedAt', self.row)

    def test_five_stale_reads_fail_without_rewrite_then_reconcile_when_fresh(self):
        self.owned_track()
        stale = copy.deepcopy(self.current)

        def stale_after_update():
            result = self.read_video()
            return {'items': [copy.deepcopy(stale)]} if self.video_update.execute.call_count else result

        self.video_read.execute.side_effect = stale_after_update
        with self.assertRaisesRegex(RuntimeError, '^localized_metadata_readback_failed$'):
            self.serve()
        self.assertEqual(self.videos.list.call_count, 7)
        self.assertEqual(self.sleep.call_args_list, [mock.call(2)] * 4)
        self.videos.update.assert_called_once()
        self.assertIn('japaneseIntentAt', self.saved[-1]['videos']['a-minjin'])
        self.assertNotIn('japaneseVerifiedAt', self.row)
        self.assertEqual(self.output.getvalue(), '')
        self.video_read.execute.side_effect = self.read_video
        self.serve()
        self.videos.update.assert_called_once()
        self.assertIn('japaneseVerifiedAt', self.row)

    def test_automatic_exact_default_ko_entry_is_accepted_without_second_update(self):
        self.owned_track()
        del self.current['localizations']['ko']
        original_fr = copy.deepcopy(self.current['localizations']['fr'])

        def materialize_default_language():
            self.update_localizations()
            self.current['localizations']['ko'] = {
                field: self.current['snippet'][field] for field in ('title', 'description')
            }

        self.video_update.execute.side_effect = materialize_default_language
        self.serve()
        self.videos.update.assert_called_once()
        self.sleep.assert_not_called()
        self.assertEqual(self.current['localizations']['fr'], original_fr)
        self.assertIn('japaneseVerifiedAt', self.row)

    def test_conflicting_preserved_ko_never_passes_eventual_readback(self):
        for field in ('title', 'description'):
            with self.subTest(field=field):
                self.reset_case()
                self.owned_track()
                original = copy.deepcopy(self.current['localizations'])

                def changed_original_locale():
                    self.update_localizations()
                    self.current['localizations']['ko'][field] = 'Changed original localization'

                self.video_update.execute.side_effect = changed_original_locale
                with self.assertRaisesRegex(RuntimeError, '^localized_metadata_readback_failed$'):
                    self.serve()
                self.videos.update.assert_called_once()
                body = self.videos.update.call_args.kwargs['body']
                self.assertEqual(body['localizations']['ko'], original['ko'])
                self.assertEqual(self.sleep.call_args_list, [mock.call(2)] * 4)
                self.assertNotIn('japaneseVerifiedAt', self.row)
                self.assertEqual(self.output.getvalue(), '')

    def test_materialized_default_cannot_bypass_original_metadata_guard(self):
        self.owned_track()
        del self.current['localizations']['ko']

        def changed_original_snippet():
            self.update_localizations()
            self.current['snippet']['title'] = 'Changed original video title'
            self.current['localizations']['ko'] = {
                field: self.current['snippet'][field] for field in ('title', 'description')
            }

        self.video_update.execute.side_effect = changed_original_snippet
        with self.assertRaisesRegex(RuntimeError, '^caption_original_metadata_changed$'):
            self.serve()
        self.videos.update.assert_called_once()
        self.sleep.assert_not_called()
        self.assertNotIn('japaneseVerifiedAt', self.row)

    def report_error(self, error):
        main_guard = next(node for node in TREE.body if isinstance(node, ast.If))
        handler = next(node for node in main_guard.body if isinstance(node, ast.Try)).handlers[0]
        print_statement = next(node for node in handler.body if isinstance(node, ast.Expr))
        module = ast.fix_missing_locations(ast.Module(body=[copy.deepcopy(print_statement)], type_ignores=[]))
        # Execute only the reporting expression, never main() or SystemExit.
        self.output.seek(0)
        self.output.truncate()
        exec(compile(module, str(SOURCE), 'exec'), {'json': json, 'error': error})
        return json.loads(self.output.getvalue())

    def test_error_output_never_echoes_arbitrary_runtime_error_text(self):
        marker = 'fixture-secret-value-not-for-output'
        for error in (RuntimeError(marker), ValueError(marker), OSError(marker),
                      RuntimeError('caption_review_required: ' + marker)):
            with self.subTest(error_type=type(error).__name__):
                result = self.report_error(error)
                self.assertEqual(result['code'], 'caption_operation_failed_without_credentials')
                self.assertNotIn(marker, self.output.getvalue())

    def test_only_exact_allowlisted_runtime_codes_are_preserved(self):
        for code in ('caption_review_required', 'caption_changed_after_review',
                     'existing_caption_identity_not_owned', 'japanese_result_unknown_no_automatic_retry'):
            with self.subTest(code=code):
                self.assertEqual(self.report_error(RuntimeError(code))['code'], code)
                self.assertEqual(self.report_error(ValueError(code))['code'],
                                 'caption_operation_failed_without_credentials')


class LocalizationReadbackTests(unittest.TestCase):
    def setUp(self):
        self.matches = extract_function('localization_readback_matches', {})
        self.expected = {'ja': copy.deepcopy(JAPANESE),
                         'fr': {'title': 'Existing FR', 'description': 'Preserve existing FR'}}
        self.verified = {'snippet': {'defaultLanguage': 'ko', 'title': 'Original KO title',
                                     'description': 'Original KO description'},
                         'localizations': copy.deepcopy(self.expected)}
        self.default_entry = {field: self.verified['snippet'][field] for field in ('title', 'description')}

    def test_exact_existing_localizations_are_accepted(self):
        self.assertTrue(self.matches(self.expected, self.verified))

    def test_only_exact_new_default_language_entry_is_ignored_without_mutation(self):
        self.verified['localizations']['ko'] = copy.deepcopy(self.default_entry)
        before = copy.deepcopy((self.expected, self.verified))
        self.assertTrue(self.matches(self.expected, self.verified))
        self.assertEqual((self.expected, self.verified), before)

    def test_altered_incomplete_or_augmented_extra_ko_is_rejected(self):
        for entry in ({**self.default_entry, 'title': 'Altered KO'},
                      {**self.default_entry, 'description': 'Altered KO'},
                      {'title': self.default_entry['title']},
                      {**self.default_entry, 'extra': 'unexpected'}, {}, None):
            with self.subTest(entry=entry):
                self.verified['localizations']['ko'] = entry
                self.assertFalse(self.matches(self.expected, self.verified))

    def test_extra_non_default_locale_is_rejected_even_with_matching_original_text(self):
        for locale in ('en', 'de', 'ko-KR'):
            with self.subTest(locale=locale):
                self.verified['localizations'] = {**copy.deepcopy(self.expected),
                                                 'ko': copy.deepcopy(self.default_entry),
                                                 locale: copy.deepcopy(self.default_entry)}
                self.assertFalse(self.matches(self.expected, self.verified))

    def test_existing_ko_must_equal_its_preserved_value_not_the_current_snippet(self):
        self.expected['ko'] = {'title': 'Preserved original KO localization', 'description': 'Preserved KO'}
        self.verified['localizations'] = copy.deepcopy(self.expected)
        self.assertTrue(self.matches(self.expected, self.verified))
        self.verified['localizations']['ko'] = copy.deepcopy(self.default_entry)
        self.assertFalse(self.matches(self.expected, self.verified))
        del self.verified['localizations']['ko']
        self.assertFalse(self.matches(self.expected, self.verified))

    def test_changed_or_missing_existing_locale_is_rejected_with_extra_default_present(self):
        for locale in self.expected:
            for missing in (False, True):
                with self.subTest(locale=locale, missing=missing):
                    self.verified['localizations'] = {**copy.deepcopy(self.expected),
                                                     'ko': copy.deepcopy(self.default_entry)}
                    if missing:
                        del self.verified['localizations'][locale]
                    else:
                        self.verified['localizations'][locale]['description'] = 'Changed preserved translation'
                    self.assertFalse(self.matches(self.expected, self.verified))

    def test_no_default_language_does_not_allow_an_extra_ko_entry(self):
        for language in (None, ''):
            with self.subTest(language=language):
                self.verified['snippet']['defaultLanguage'] = language
                self.verified['localizations']['ko'] = copy.deepcopy(self.default_entry)
                self.assertFalse(self.matches(self.expected, self.verified))


if __name__ == '__main__':
    unittest.main()
