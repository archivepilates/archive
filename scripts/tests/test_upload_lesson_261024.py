"""Offline protocol tests; no production CLI, credentials, or ledger access."""

import argparse
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from types import ModuleType
import unittest
from unittest import mock


UPLOADER = Path(__file__).resolve().parents[1] / 'upload-lesson-261024.py'
SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture'
VIDEO_ID = 'fixture0001'


def load_uploader():
    names = (
        'google', 'google.auth', 'google.auth.transport',
        'google.auth.transport.requests', 'google.oauth2',
        'google.oauth2.credentials', 'googleapiclient',
        'googleapiclient.discovery',
    )
    modules = {name: ModuleType(name) for name in names}
    for name, module in modules.items():
        module.__path__ = []
        if '.' in name:
            parent, child = name.rsplit('.', 1)
            setattr(modules[parent], child, module)
    transport = modules['google.auth.transport.requests']
    transport.AuthorizedSession = mock.Mock(side_effect=AssertionError('Auth forbidden'))
    transport.Request = mock.Mock(side_effect=AssertionError('Token refresh forbidden'))
    credentials = mock.Mock(side_effect=AssertionError('Credentials forbidden'))
    credentials.from_authorized_user_file.side_effect = AssertionError('Token read forbidden')
    modules['google.oauth2.credentials'].Credentials = credentials
    modules['googleapiclient.discovery'].build = mock.Mock(
        side_effect=AssertionError('API client forbidden')
    )
    with mock.patch.dict(sys.modules, modules):
        spec = importlib.util.spec_from_file_location('offline_upload_lesson_261024', UPLOADER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    credentials.from_authorized_user_file.assert_not_called()
    transport.AuthorizedSession.assert_not_called()
    transport.Request.assert_not_called()
    modules['googleapiclient.discovery'].build.assert_not_called()
    return module


class OfflineUploaderTests(unittest.TestCase):
    def setUp(self):
        # Importlib may read the uploader source, but application I/O is forbidden.
        guards = (
            mock.patch.object(sys, 'dont_write_bytecode', True),
            mock.patch('builtins.open', side_effect=AssertionError('File access forbidden')),
            mock.patch.object(io, 'open', side_effect=AssertionError('File access forbidden')),
            mock.patch.object(Path, 'open', side_effect=AssertionError('Path access forbidden')),
            mock.patch.object(os, 'open', side_effect=AssertionError('OS file access forbidden')),
            mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')),
            mock.patch.object(socket.socket, 'connect_ex', side_effect=AssertionError('Network forbidden')),
            mock.patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')),
            mock.patch.object(subprocess, 'Popen', side_effect=AssertionError('Process forbidden')),
            mock.patch.object(argparse, 'ArgumentParser', side_effect=AssertionError('CLI forbidden')),
        )
        for guard in guards:
            self.enterContext(guard)
        self.uploader = load_uploader()
        self.save = self.enterContext(mock.patch.object(self.uploader, 'save'))
        self.enterContext(mock.patch.object(
            self.uploader, 'clients', side_effect=AssertionError('Clients forbidden')
        ))


class ReadResponseTests(OfflineUploaderTests):
    def setUp(self):
        super().setUp()
        self.row = {
            'source': {'size': 1024}, 'uploadedBytes': 256,
            'state': 'uploading', 'sessionUri': SESSION,
        }
        self.state = {'videos': {'fixture': self.row}}

    def response(self, status=308, received=None, payload=None):
        response = mock.Mock(spec=['status_code', 'headers', 'json'])
        response.status_code = status
        response.headers = {} if received is None else {'Range': received}
        response.json.return_value = payload
        return response

    def completion(self, status=200, **changes):
        payload = {'id': VIDEO_ID, 'snippet': {'channelId': self.uploader.CHANNEL}}
        payload.update(changes)
        return self.response(status=status, payload=payload)

    def assert_rejected(self, response, error, **context):
        before = copy.deepcopy(self.state)
        with self.assertRaisesRegex(RuntimeError, '^' + error + '$'):
            self.uploader.read_response(response, self.row, self.state, **context)
        self.assertEqual(self.state, before)
        self.save.assert_not_called()

    def test_chunk_accepts_partial_and_exact_end_acknowledgements(self):
        for offset in (257, 384, 512):
            with self.subTest(offset=offset):
                self.save.reset_mock()
                self.row['uploadedBytes'] = 256
                response = self.response(received=f'bytes=0-{offset - 1}')
                self.assertIs(self.uploader.read_response(
                    response, self.row, self.state, start=256, end=512
                ), False)
                self.assertEqual(self.row['uploadedBytes'], offset)
                self.assertEqual(self.row['sessionUri'], SESSION)
                self.assertEqual(self.row['state'], 'uploading')
                self.assertNotIn('youtubeId', self.row)
                self.save.assert_called_once_with(self.state)
                response.json.assert_not_called()

    def test_chunk_rejects_missing_regressing_no_progress_and_overrun_ack(self):
        for offset in (None, 1, 255, 256, 513, 1023):
            with self.subTest(offset=offset):
                received = None if offset is None else f'bytes=0-{offset - 1}'
                self.assert_rejected(self.response(received=received),
                                     'chunk_acknowledgement_requires_reconciliation',
                                     start=256, end=512)

    def test_chunk_requires_both_request_bounds(self):
        for context in ({}, {'start': 256}, {'end': 512}):
            with self.subTest(context=context):
                self.assert_rejected(self.response(received='bytes=0-511'),
                                     'chunk_acknowledgement_requires_reconciliation', **context)

    def test_empty_initial_probe_is_allowed(self):
        self.row['uploadedBytes'] = 0
        response = self.response()
        self.assertIs(self.uploader.read_response(
            response, self.row, self.state, probe=True
        ), False)
        self.assertEqual(self.row['uploadedBytes'], 0)
        self.save.assert_called_once_with(self.state)

    def test_probe_accepts_equal_and_advanced_offsets_without_chunk_bounds(self):
        for offset in (256, 257, 1023):
            with self.subTest(offset=offset):
                self.save.reset_mock()
                self.row['uploadedBytes'] = 256
                self.assertIs(self.uploader.read_response(
                    self.response(received=f'bytes=0-{offset - 1}'),
                    self.row, self.state, probe=True
                ), False)
                self.assertEqual(self.row['uploadedBytes'], offset)
                self.save.assert_called_once_with(self.state)

    def test_probe_rejects_missing_or_regressing_offset_after_progress(self):
        for received in (None, 'bytes=0-0', 'bytes=0-254'):
            with self.subTest(received=received):
                self.assert_rejected(self.response(received=received),
                                     'upload_offset_regressed_requires_review', probe=True)

    def test_malformed_ranges_are_rejected_in_both_contexts(self):
        for probe in (False, True):
            for received in ('bytes=1-511', 'bytes=0--1', 'bytes=0-abc', '0-511',
                             'bytes 0-511', 'bytes=0-511/1024', 'bytes=0-511 ',
                             'bytes=0-511\n', 'bytes=0-1,3-511'):
                with self.subTest(probe=probe, received=received):
                    self.assert_rejected(self.response(received=received),
                                         'unexpected_upload_range', probe=probe, start=256, end=512)

    def test_308_cannot_acknowledge_total_size_or_beyond(self):
        for probe in (False, True):
            for offset in (1024, 1025, 10**30):
                with self.subTest(probe=probe, offset=offset):
                    self.assert_rejected(self.response(received=f'bytes=0-{offset - 1}'),
                                         'invalid_upload_offset', probe=probe, start=256, end=1024)

    def test_success_requires_final_chunk_end_unless_probing(self):
        for status in (200, 201):
            for end in (None, 512, 1023, 1025):
                with self.subTest(status=status, end=end):
                    response = self.completion(status=status)
                    self.assert_rejected(response, 'premature_completion_requires_review',
                                         start=256, end=end)
                    response.json.assert_not_called()

    def test_final_chunk_and_completed_probe_persist_video_id(self):
        for status in (200, 201):
            for probe in (False, True):
                with self.subTest(status=status, probe=probe):
                    self.save.reset_mock()
                    self.row.pop('youtubeId', None)
                    self.row.update(uploadedBytes=256, state='uploading', sessionUri=SESSION)
                    context = {'probe': True} if probe else {'start': 256, 'end': 1024}
                    self.assertIs(self.uploader.read_response(
                        self.completion(status=status), self.row, self.state, **context
                    ), True)
                    self.assertEqual(self.row['youtubeId'], VIDEO_ID)
                    self.assertEqual(self.row['uploadedBytes'], 1024)
                    self.assertEqual(self.row['state'], 'private_uploaded')
                    self.assertNotIn('sessionUri', self.row)
                    self.save.assert_called_once_with(self.state)

    def test_invalid_completion_ids_do_not_destroy_session(self):
        for probe in (False, True):
            for video_id in ('', 'short', 'a' * 12, 'bad/id00001', 'a' * 10 + '!'):
                with self.subTest(probe=probe, video_id=video_id):
                    self.assert_rejected(self.completion(id=video_id),
                                         'upload_completion_requires_review', probe=probe, end=1024)
            with self.subTest(probe=probe, missing_id=True):
                self.assert_rejected(self.response(status=200, payload={}),
                                     'upload_completion_requires_review', probe=probe, end=1024)

    def test_missing_or_wrong_completion_channel_preserves_session(self):
        for probe in (False, True):
            for snippet in ({}, {'channelId': 'other-channel'}):
                with self.subTest(probe=probe, snippet=snippet):
                    self.assert_rejected(self.completion(snippet=snippet),
                                         'uploaded_channel_mismatch', probe=probe, end=1024)
            with self.subTest(probe=probe, missing_snippet=True):
                self.assert_rejected(self.response(status=200, payload={'id': VIDEO_ID}),
                                     'uploaded_channel_mismatch', probe=probe, end=1024)

    def test_http_errors_neither_parse_body_nor_persist(self):
        for probe in (False, True):
            for status in (204, 301, 307, 400, 401, 403, 404, 410, 429, 500, 503):
                with self.subTest(probe=probe, status=status):
                    response = self.response(status=status)
                    self.assert_rejected(response, f'upload_http_{status}_requires_review',
                                         probe=probe, start=256, end=1024)
                    response.json.assert_not_called()

    def test_invalid_completion_json_does_not_mutate_or_persist(self):
        response = self.completion()
        response.json.side_effect = ValueError('fixture malformed JSON')
        before = copy.deepcopy(self.state)
        with self.assertRaises(ValueError):
            self.uploader.read_response(response, self.row, self.state, probe=True)
        self.assertEqual(self.state, before)
        self.save.assert_not_called()

    def test_persistence_failure_is_not_reported_as_success(self):
        for response, context in (
            (self.response(received='bytes=0-511'), {'start': 256, 'end': 512}),
            (self.completion(), {'probe': True}),
        ):
            with self.subTest(context=context):
                self.save.reset_mock()
                self.save.side_effect = OSError('fixture persistence failure')
                with self.assertRaises(OSError):
                    self.uploader.read_response(response, self.row, self.state, **context)
                self.save.assert_called_once_with(self.state)


class ValidateSessionTests(OfflineUploaderTests):
    def test_valid_urls_are_returned_unchanged(self):
        for uri in (SESSION, SESSION.replace('.com/', '.com:443/'),
                    SESSION.replace('www.googleapis.com', 'WWW.GOOGLEAPIS.COM'),
                    SESSION + '&opaque=a%2Fb%3Dc'):
            with self.subTest(uri=uri):
                self.assertEqual(self.uploader.validate_session(uri), uri)
        self.save.assert_not_called()

    def test_unsafe_urls_are_rejected(self):
        urls = (
            '', '/upload/youtube/v3/videos', '//www.googleapis.com/upload/youtube/v3/videos',
            SESSION.replace('https:', 'http:'), SESSION.replace('https:', 'ftp:'),
            SESSION.replace('www.googleapis.com', 'untrusted.invalid'),
            SESSION.replace('www.googleapis.com', 'www.googleapis.com.untrusted.invalid'),
            SESSION.replace('www.googleapis.com', 'sub.www.googleapis.com'),
            SESSION.replace('www.googleapis.com', 'www.googleapis.com.'),
            SESSION.replace('/videos?', '/videos/?'), SESSION.replace('/videos?', '/other?'),
            SESSION.replace('/upload/', '/upload/../upload/'),
            SESSION.replace('.com/', '.com:80/'), SESSION.replace('.com/', '.com:444/'),
            SESSION.replace('www.', 'user@www.'), SESSION.replace('www.', 'user:pass@www.'),
            SESSION.replace('www.', '@www.'), SESSION + '#fragment',
        )
        for uri in urls:
            with self.subTest(uri=uri):
                with self.assertRaisesRegex(RuntimeError, '^unsafe_upload_session$'):
                    self.uploader.validate_session(uri)
        self.save.assert_not_called()

    def test_malformed_authority_or_port_fails_closed(self):
        for uri in (SESSION.replace('.com/', '.com:invalid/'),
                    SESSION.replace('.com/', '.com:65536/'),
                    'https://[invalid/upload/youtube/v3/videos'):
            with self.subTest(uri=uri):
                with self.assertRaises(ValueError):
                    self.uploader.validate_session(uri)
        self.save.assert_not_called()


class ShareUnlistedTests(OfflineUploaderTests):
    def setUp(self):
        super().setUp()
        self.youtube = mock.Mock(spec=['videos'])
        self.videos = mock.Mock(spec=['list', 'update'])
        self.youtube.videos.return_value = self.videos
        self.list_request = mock.Mock(spec=['execute'])
        self.update_request = mock.Mock(spec=['execute'])
        self.videos.list.return_value = self.list_request
        self.videos.update.return_value = self.update_request
        self.enterContext(mock.patch.object(self.uploader, 'clients',
                                           return_value=(self.youtube, None, None)))
        self.enterContext(mock.patch.object(self.uploader.time, 'time', return_value=1234567890.5))
        self.output = self.enterContext(mock.patch.object(sys, 'stdout', new=io.StringIO()))
        self.reset_case()

    def reset_case(self, key='a-minjin'):
        self.key = key
        self.row = {'youtubeId': VIDEO_ID, 'state': 'private_uploaded',
                    'source': {'sha256': 'a' * 64, 'size': 1024},
                    'snippet': {'title': 'ARCHIVE PILATES full-class fixture',
                                'description': 'Synthetic student-sharing fixture',
                                'tags': ['zeta', 'alpha', 'middle'], 'categoryId': '27',
                                'defaultLanguage': 'ko', 'defaultAudioLanguage': 'ko'}}
        self.state = {'videos': {key: self.row}}
        self.current = {'id': VIDEO_ID,
                        'snippet': {**copy.deepcopy(self.row['snippet']), 'channelId': self.uploader.CHANNEL},
                        'status': {'privacyStatus': 'private', 'uploadStatus': 'processed',
                                   'embeddable': True, 'license': 'youtube'},
                        'processingDetails': {'processingStatus': 'succeeded'}}
        self.saved = []
        self.events = []
        self.save.reset_mock()
        self.save.side_effect = self.persist
        self.videos.reset_mock()
        self.list_request.reset_mock()
        self.list_request.execute.side_effect = self.read_video
        self.update_request.reset_mock()
        self.update_request.execute.side_effect = self.apply_update
        self.output.seek(0)
        self.output.truncate()

    def persist(self, state):
        self.assertIs(state, self.state)
        self.saved.append(copy.deepcopy(state))
        self.events.append('save')

    def read_video(self):
        self.events.append('read')
        self.assertEqual(self.videos.list.call_args, mock.call(
            part='snippet,status,processingDetails,contentDetails', id=VIDEO_ID
        ))
        return {'items': [copy.deepcopy(self.current)]}

    def apply_update(self):
        # Assert a durable intent snapshot exists before any mocked provider write.
        self.assertEqual(self.saved[-1]['videos'][self.key]['unlistedIntentAt'], 1234567890.5)
        self.assertEqual(self.saved[-1]['videos'][self.key]['state'], 'private_uploaded')
        self.assertEqual(self.videos.update.call_args, mock.call(part='status', body={
            'id': VIDEO_ID, 'status': {'privacyStatus': 'unlisted', 'embeddable': True,
                                     'license': 'youtube', 'selfDeclaredMadeForKids': False},
        }))
        self.events.append('update')
        self.current['status']['privacyStatus'] = 'unlisted'
        return {'id': VIDEO_ID}

    def share(self):
        self.uploader.share_unlisted(self.state, self.key)

    def assert_initial_rejection(self, code):
        before = copy.deepcopy(self.state)
        with self.assertRaisesRegex(RuntimeError, '^' + code + '$'):
            self.share()
        self.assertEqual(self.state, before)
        self.save.assert_not_called()
        self.videos.update.assert_not_called()
        self.assertEqual(self.output.getvalue(), '')

    def test_all_four_files_share_only_unlisted_after_intent_and_fresh_readback(self):
        for key in self.uploader.FILES:
            with self.subTest(key=key):
                self.reset_case(key)
                original = copy.deepcopy(self.row)
                self.share()
                self.assertEqual(self.events, ['read', 'save', 'update', 'read', 'save'])
                self.videos.update.assert_called_once()
                self.assertEqual(self.videos.list.call_count, 2)
                self.assertEqual(self.row['state'], 'unlisted_verified')
                self.assertEqual(self.row['url'], f'https://www.youtube.com/watch?v={VIDEO_ID}')
                self.assertEqual(self.row['snippet'], original['snippet'])
                self.assertEqual(self.row['source'], original['source'])
                self.assertEqual(self.saved[-1], self.state)
                self.assertEqual(json.loads(self.output.getvalue())['visibility'], 'unlisted')

    def test_reordered_tags_are_accepted_without_rewriting_metadata(self):
        self.current['snippet']['tags'].sort()
        before = copy.deepcopy(self.row['snippet'])
        self.share()
        self.assertEqual(self.row['snippet'], before)
        self.videos.update.assert_called_once()
        self.assertEqual(self.row['state'], 'unlisted_verified')

    def test_changed_missing_or_nonlist_tags_block_before_any_provider_write(self):
        for tags in ([], ['zeta', 'alpha'], ['zeta', 'alpha', 'changed'],
                     ['zeta', 'alpha', 'middle', 'extra'], None, 'alpha,middle,zeta'):
            with self.subTest(tags=tags):
                self.reset_case()
                self.current['snippet']['tags'] = tags
                self.assert_initial_rejection('sharing_metadata_changed')
        self.reset_case()
        del self.current['snippet']['tags']
        self.assert_initial_rejection('sharing_metadata_changed')

    def test_tag_order_normalization_preserves_duplicate_multiplicity(self):
        self.row['snippet']['tags'] = ['zeta', 'alpha', 'alpha']
        self.current['snippet']['tags'] = ['alpha', 'zeta', 'alpha']
        self.share()
        for tags in (['zeta', 'alpha'], ['alpha', 'zeta', 'zeta']):
            with self.subTest(tags=tags):
                self.reset_case()
                self.row['snippet']['tags'] = ['zeta', 'alpha', 'alpha']
                self.current['snippet']['tags'] = tags
                self.assert_initial_rejection('sharing_metadata_changed')

    def test_every_other_metadata_field_stays_strict(self):
        for field, changed in (('title', 'Changed title'), ('description', 'Changed description'),
                               ('categoryId', 27), ('defaultLanguage', 'ja'), ('defaultAudioLanguage', 'ja')):
            for missing in (False, True):
                with self.subTest(field=field, missing=missing):
                    self.reset_case()
                    if missing:
                        del self.current['snippet'][field]
                    else:
                        self.current['snippet'][field] = changed
                    self.assert_initial_rejection('sharing_metadata_changed')

    def test_channel_and_ambiguous_video_results_block_before_intent(self):
        for rows in ([], [self.current, self.current],
                     [{**self.current, 'snippet': {**self.current['snippet'], 'channelId': 'wrong-channel'}}]):
            with self.subTest(rows=len(rows)):
                self.reset_case()
                self.list_request.execute.side_effect = None
                self.list_request.execute.return_value = {'items': copy.deepcopy(rows)}
                self.assert_initial_rejection('sharing_channel_mismatch')

    def test_public_or_unknown_visibility_never_causes_an_automatic_change(self):
        for privacy in ('public', 'unknown', None):
            with self.subTest(privacy=privacy):
                self.reset_case()
                self.current['status']['privacyStatus'] = privacy
                self.assert_initial_rejection('unexpected_visibility_no_automatic_change')

    def test_processing_and_embedding_must_be_ready_before_intent(self):
        for section, field, value in (
            ('status', 'uploadStatus', 'uploaded'), ('status', 'uploadStatus', None),
            ('processingDetails', 'processingStatus', 'processing'),
            ('processingDetails', 'processingStatus', 'failed'),
            ('processingDetails', 'processingStatus', None),
            ('status', 'embeddable', False), ('status', 'embeddable', 1), ('status', 'embeddable', None),
        ):
            with self.subTest(section=section, field=field, value=value):
                self.reset_case()
                self.current[section][field] = value
                self.assert_initial_rejection('video_processing_or_embedding_not_ready')

    def test_private_with_prior_unknown_intent_never_replays_the_update(self):
        self.row['unlistedIntentAt'] = 1234567800.0
        self.assert_initial_rejection('prior_sharing_intent_requires_review')

    def test_already_unlisted_only_reconciles_even_with_prior_intent(self):
        for prior_intent in (False, True):
            with self.subTest(prior_intent=prior_intent):
                self.reset_case()
                self.current['status']['privacyStatus'] = 'unlisted'
                if prior_intent:
                    self.row['unlistedIntentAt'] = 1234567800.0
                self.share()
                self.assertEqual(self.events, ['read', 'read', 'save'])
                self.videos.update.assert_not_called()
                self.assertEqual(self.row['state'], 'unlisted_verified')

    def test_pending_caption_review_is_not_claimed_serving_and_does_not_add_japanese(self):
        self.row['captionReview'] = 'pending'
        self.share()
        self.assertEqual(self.row['captionReview'], 'pending_separate_track_review')
        self.assertNotIn('japaneseMetadata', self.row)
        self.assertNotIn('localizations', self.current)
        self.assertNotIn('koreanCaptions', self.row)
        self.assertEqual(json.loads(self.output.getvalue())['captionReview'], self.row['captionReview'])
        self.assertEqual(self.videos.update.call_args.kwargs['part'], 'status')

    def test_intent_persistence_failure_prevents_the_update(self):
        self.save.side_effect = OSError('fixture persistence failure')
        with self.assertRaises(OSError):
            self.share()
        self.videos.update.assert_not_called()
        self.assertEqual(self.saved, [])
        self.assertEqual(self.output.getvalue(), '')

    def test_ambiguous_update_reconciles_unlisted_but_blocks_replay_if_still_private(self):
        for accepted in (False, True):
            with self.subTest(accepted=accepted):
                self.reset_case()

                def ambiguous_update():
                    if accepted:
                        self.apply_update()
                    raise ConnectionError('fixture ambiguous response')

                self.update_request.execute.side_effect = ambiguous_update
                with self.assertRaises(ConnectionError):
                    self.share()
                self.assertEqual(len(self.saved), 1)
                self.assertIn('unlistedIntentAt', self.saved[0]['videos'][self.key])
                self.assertNotIn('unlistedVerifiedAt', self.row)
                self.assertEqual(self.output.getvalue(), '')
                if accepted:
                    self.share()
                    self.assertEqual(self.row['state'], 'unlisted_verified')
                else:
                    with self.assertRaisesRegex(RuntimeError, '^prior_sharing_intent_requires_review$'):
                        self.share()
                self.videos.update.assert_called_once()

    def test_private_readback_retains_intent_and_blocks_retry(self):
        self.update_request.execute.side_effect = lambda: None
        with self.assertRaisesRegex(RuntimeError, '^sharing_readback_failed_no_retry$'):
            self.share()
        self.assertEqual(len(self.saved), 1)
        self.assertNotIn('unlistedVerifiedAt', self.row)
        with self.assertRaisesRegex(RuntimeError, '^prior_sharing_intent_requires_review$'):
            self.share()
        self.videos.update.assert_called_once()
        self.assertEqual(self.output.getvalue(), '')

    def test_changed_readback_metadata_is_not_marked_verified(self):
        def changed_update():
            self.apply_update()
            self.current['snippet']['tags'].append('unexpected')

        self.update_request.execute.side_effect = changed_update
        with self.assertRaisesRegex(RuntimeError, '^sharing_metadata_changed$'):
            self.share()
        self.assertEqual(len(self.saved), 1)
        self.assertNotIn('unlistedVerifiedAt', self.row)
        self.assertEqual(self.output.getvalue(), '')

    def test_unlisted_readback_must_still_be_processed_and_embeddable(self):
        for section, field, value in (
            ('status', 'embeddable', False), ('status', 'uploadStatus', 'uploaded'),
            ('processingDetails', 'processingStatus', 'failed'),
        ):
            with self.subTest(field=field):
                self.reset_case()

                def changed_update():
                    self.apply_update()
                    self.current[section][field] = value

                self.update_request.execute.side_effect = changed_update
                with self.assertRaises(RuntimeError):
                    self.share()
                self.assertEqual(len(self.saved), 1)
                self.assertNotIn('unlistedVerifiedAt', self.row)
                self.assertEqual(self.output.getvalue(), '')

    def test_lost_readback_preserves_intent_for_reconciliation_without_another_update(self):
        self.list_request.execute.side_effect = [
            {'items': [copy.deepcopy(self.current)]}, ConnectionError('fixture lost readback'),
        ]
        with self.assertRaises(ConnectionError):
            self.share()
        self.assertEqual(len(self.saved), 1)
        self.assertNotIn('unlistedVerifiedAt', self.row)
        self.assertEqual(self.output.getvalue(), '')
        self.list_request.execute.side_effect = self.read_video
        self.share()
        self.videos.update.assert_called_once()
        self.assertEqual(self.row['state'], 'unlisted_verified')

    def test_final_persistence_failure_does_not_print_a_success_receipt(self):
        def fail_final_save(state):
            if self.saved:
                raise OSError('fixture final persistence failure')
            self.persist(state)

        self.save.side_effect = fail_final_save
        with self.assertRaises(OSError):
            self.share()
        self.assertEqual(len(self.saved), 1)
        self.assertNotIn('unlistedVerifiedAt', self.saved[0]['videos'][self.key])
        self.assertEqual(self.output.getvalue(), '')
        self.videos.update.assert_called_once()


if __name__ == '__main__':
    unittest.main()
