"""Synthetic C/D adapter regression tests; no credentials, ledgers or live CLI."""

import copy
import importlib.util
import io
import os
from pathlib import Path
import socket
import subprocess
import sys
from types import ModuleType
import unittest
from unittest import mock

import test_upload_lesson_261024 as baseline


ADAPTER = Path(__file__).resolve().parents[1] / 'lesson-videos-261025.py'
KEYS = {'c-minjin', 'd-minjin', 'c-eunyeong', 'd-eunyeong'}


def load_adapter():
    spec = importlib.util.spec_from_file_location('offline_cd_adapter', ADAPTER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AdapterTestBase(baseline.OfflineUploaderTests):
    def setUp(self):
        super().setUp()
        for guard in (
            mock.patch.object(Path, 'mkdir', side_effect=AssertionError('Mkdir forbidden')),
            mock.patch.object(Path, 'iterdir', side_effect=AssertionError('Source scan forbidden')),
            mock.patch.object(Path, 'read_bytes', side_effect=AssertionError('Read forbidden')),
            mock.patch.object(Path, 'read_text', side_effect=AssertionError('Read forbidden')),
            mock.patch.object(Path, 'write_text', side_effect=AssertionError('Write forbidden')),
            mock.patch.object(Path, 'replace', side_effect=AssertionError('Rename forbidden')),
            mock.patch.object(os, 'mkdir', side_effect=AssertionError('Mkdir forbidden')),
            mock.patch.object(os, 'system', side_effect=AssertionError('Process forbidden')),
        ):
            self.enterContext(guard)
        self.adapter = load_adapter()

    def caption_module(self):
        names = ('google', 'google.auth', 'google.auth.transport',
                 'google.auth.transport.requests', 'google.oauth2',
                 'google.oauth2.credentials', 'googleapiclient',
                 'googleapiclient.discovery', 'googleapiclient.http')
        modules = {name: ModuleType(name) for name in names}
        for name, module in modules.items():
            module.__path__ = []
            if '.' in name:
                parent, child = name.rsplit('.', 1)
                setattr(modules[parent], child, module)
        transport = modules['google.auth.transport.requests']
        transport.AuthorizedSession = mock.Mock(side_effect=AssertionError('Auth forbidden'))
        transport.Request = mock.Mock(side_effect=AssertionError('Refresh forbidden'))
        credentials = mock.Mock(side_effect=AssertionError('Credentials forbidden'))
        credentials.from_authorized_user_file.side_effect = AssertionError('Token forbidden')
        modules['google.oauth2.credentials'].Credentials = credentials
        modules['googleapiclient.discovery'].build = mock.Mock(side_effect=AssertionError('API forbidden'))
        modules['googleapiclient.http'].MediaIoBaseUpload = mock.Mock(side_effect=AssertionError('Media forbidden'))
        with mock.patch.dict(sys.modules, modules):
            return self.adapter.load('serve-lesson-261024-captions.py')


class AdapterTests(AdapterTestBase):

    def test_import_has_no_application_io_auth_or_entrypoint(self):
        with mock.patch('importlib.util.spec_from_file_location', wraps=importlib.util.spec_from_file_location) as specs:
            adapter = load_adapter()
        self.assertEqual(specs.call_count, 1)
        self.assertEqual(set(adapter.FILES), KEYS)
        self.uploader.clients.assert_not_called()
        self.save.assert_not_called()

    def test_exact_cd_keys_teams_and_original_filename_mapping(self):
        self.assertEqual(set(self.adapter.FILES), KEYS)
        for key, (filename, team, short, instructor, equipment) in self.adapter.FILES.items():
            with self.subTest(key=key):
                self.assertEqual(team, key[0].upper())
                self.assertTrue(filename.startswith('#9 '))
                self.assertTrue(filename.endswith(f' {team}.m4v'))
                self.assertTrue(all((short, instructor, equipment)))
                self.assertNotIn(team, ('A', 'B', 'E'))

    def test_new_root_and_file_mapping_are_separate_from_ab(self):
        original_root, original_files = self.uploader.ROOT, copy.deepcopy(self.uploader.FILES)
        configured = self.adapter.configure(baseline.load_uploader())
        self.assertEqual(configured.ROOT.name, 'lesson-videos-261025')
        self.assertEqual(configured.ROOT.parent, original_root.parent)
        self.assertNotEqual(configured.ROOT, original_root)
        self.assertEqual(set(configured.FILES), KEYS)
        configured.FILES.pop('c-minjin')
        self.assertEqual(set(self.adapter.FILES), KEYS)
        self.assertEqual(self.uploader.ROOT, original_root)
        self.assertEqual(self.uploader.FILES, original_files)

    def test_korean_date_team_languages_and_non_sale_metadata(self):
        module = self.adapter.configure(baseline.load_uploader())
        for key in KEYS:
            with self.subTest(key=key):
                metadata = module.metadata(key)
                self.assertIn('261025', metadata['title'])
                self.assertNotIn('261024', metadata['title'])
                self.assertIn('2026\ub144 10\uc6d4 25\uc77c', metadata['description'])
                self.assertNotIn('2026\ub144 10\uc6d4 24\uc77c', metadata['description'])
                self.assertIn(f'{key[0].upper()}\ud300', metadata['title'])
                self.assertIn('\ube44\ud310\ub9e4', metadata['description'])
                self.assertEqual(metadata['defaultLanguage'], 'ko')
                self.assertEqual(metadata['defaultAudioLanguage'], 'ko')
                self.assertIn('ARCHIVE PILATES', metadata['description'])
        for key in ('a-minjin', 'b-eunyeong', 'e-minjin', 'C-minjin', 'all'):
            with self.subTest(rejected_key=key), self.assertRaises(KeyError):
                module.metadata(key)

    def test_configure_preserves_source_channel_and_safety_function_identity(self):
        module = baseline.load_uploader()
        fields = ('SOURCE', 'CHANNEL', 'TOKEN', 'clients', 'source_file', 'digest',
                  'record_source', 'save', 'validate_session', 'read_response',
                  'upload', 'share_unlisted', 'main')
        before = {field: getattr(module, field) for field in fields}
        self.assertIs(self.adapter.configure(module), module)
        for field, value in before.items():
            with self.subTest(field=field):
                self.assertIs(getattr(module, field), value)

    def test_configured_module_does_not_mutate_independent_ab_module(self):
        before = {key: self.uploader.metadata(key) for key in self.uploader.FILES}
        original_metadata = self.uploader.metadata
        self.adapter.configure(baseline.load_uploader())
        self.assertIs(self.uploader.metadata, original_metadata)
        self.assertEqual({key: self.uploader.metadata(key) for key in self.uploader.FILES}, before)
        self.assertTrue(all('261024' in row['title'] for row in before.values()))

    def test_upload_routing_delegates_only_to_mocked_configured_main(self):
        module = baseline.load_uploader()
        module.main = mock.Mock()
        argv = ['adapter', 'upload-private', 'c-minjin']
        with mock.patch.object(self.adapter, 'load', return_value=module) as load, \
                mock.patch.object(sys, 'argv', argv):
            self.adapter.main()
            self.assertEqual(sys.argv, argv)
        load.assert_called_once_with('upload-lesson-261024.py')
        module.main.assert_called_once_with()
        self.assertEqual(set(module.FILES), KEYS)
        self.assertEqual(module.ROOT, self.adapter.ROOT)

    def test_caption_routing_updates_ja_date_without_changing_protocol(self):
        captions = self.caption_module()
        original_japanese = captions.japanese
        original_lesson = captions.lesson
        caption_source = captions.main
        captures = []

        def capture():
            captures.append((list(sys.argv), {key: captions.japanese(key) for key in KEYS}))

        with mock.patch.object(captions, 'main', side_effect=capture) as main, \
                mock.patch.object(self.adapter, 'load', return_value=captions) as load, \
                mock.patch.object(sys, 'argv', ['adapter', 'serve-captions', 'd-eunyeong']):
            self.adapter.main()
        load.assert_called_once_with('serve-lesson-261024-captions.py')
        main.assert_called_once_with()
        self.assertIs(captions.main, caption_source)
        self.assertIs(captions.lesson, original_lesson)
        self.assertEqual(captions.lesson.ROOT, self.adapter.ROOT)
        self.assertEqual(captures[0][0], ['adapter', 'd-eunyeong'])
        for key, localized in captures[0][1].items():
            with self.subTest(key=key):
                self.assertIn('261025', localized['title'])
                self.assertNotIn('261024', localized['title'])
                self.assertIn('2026\u5e7410\u670825\u65e5', localized['description'])
                self.assertNotIn('2026\u5e7410\u670824\u65e5', localized['description'])
                self.assertIn(key[0].upper(), localized['title'])
        self.assertIsNot(captions.japanese, original_japanese)
        self.assertEqual(set(self.uploader.FILES), {'a-minjin', 'b-minjin', 'a-eunyeong', 'b-eunyeong'})

    def test_transcribe_routing_changes_root_without_running_transcriber(self):
        transcriber = ModuleType('offline_transcriber')
        transcriber.main = mock.Mock()
        with mock.patch.object(self.adapter, 'load', return_value=transcriber) as load, \
                mock.patch.object(sys, 'argv', ['adapter', 'transcribe']):
            self.adapter.main()
        load.assert_called_once_with('transcribe-lesson-261024.py')
        transcriber.main.assert_called_once_with()
        self.assertEqual(transcriber.ROOT, self.adapter.ROOT)

    def test_transcribe_extra_arguments_reject_before_loading_or_running(self):
        for extra in ('c-minjin', '--all', '--root=old'):
            with self.subTest(extra=extra), \
                    mock.patch.object(self.adapter, 'load') as load, \
                    mock.patch.object(sys, 'argv', ['adapter', 'transcribe', extra]), \
                    self.assertRaisesRegex(RuntimeError, '^transcribe_has_no_extra_arguments$'):
                self.adapter.main()
            load.assert_not_called()


class CDReadResponseTests(baseline.ReadResponseTests):
    def setUp(self):
        super().setUp()
        load_adapter().configure(self.uploader)


class CDValidateSessionTests(baseline.ValidateSessionTests):
    def setUp(self):
        super().setUp()
        load_adapter().configure(self.uploader)


class CDShareUnlistedTests(baseline.ShareUnlistedTests):
    def setUp(self):
        super().setUp()
        load_adapter().configure(self.uploader)

    def reset_case(self, key='c-minjin'):
        super().reset_case(key)


class CDPrivateUploadTests(AdapterTestBase):
    def setUp(self):
        super().setUp()
        self.adapter.configure(self.uploader)
        self.youtube, self.session = mock.Mock(), mock.Mock()
        self.enterContext(mock.patch.object(self.uploader, 'clients',
                          return_value=(self.youtube, self.session, 'synthetic-playlist')))
        self.file = mock.Mock()
        self.file.stat.return_value.st_size = 2048
        self.row = {'source': {'size': 2048, 'sha256': 'a' * 64},
                    'snippet': self.uploader.metadata('c-minjin'),
                    'state': 'source_verified', 'visualReviewPassed': True}
        self.state = {'videos': {'c-minjin': self.row}}
        self.enterContext(mock.patch.object(self.uploader, 'record_source',
                          return_value=(self.file, self.row)))
        self.inventory = self.enterContext(mock.patch.object(self.uploader, 'inventory', return_value=[]))
        self.session.post.return_value.status_code = 200
        self.session.post.return_value.headers = {'Location': baseline.SESSION}
        self.session.put.return_value.status_code = 200
        self.session.put.return_value.json.return_value = {
            'id': baseline.VIDEO_ID, 'snippet': {'channelId': self.uploader.CHANNEL}}

    def test_private_upload_sets_private_no_subscriber_notification_and_cd_metadata(self):
        response = self.session.post.return_value

        def create(*args, **kwargs):
            self.assertEqual(self.row['state'], 'upload_intent')
            self.assertNotIn('sessionUri', self.row)
            self.save.assert_called_once_with(self.state)
            return response

        self.session.post.side_effect = create
        self.uploader.upload(self.state, 'c-minjin')
        self.session.post.assert_called_once()
        call = self.session.post.call_args.kwargs
        self.assertEqual(call['params']['notifySubscribers'], 'false')
        self.assertEqual(call['json']['status']['privacyStatus'], 'private')
        self.assertIs(call['json']['status']['embeddable'], True)
        self.assertFalse(call['allow_redirects'])
        self.assertIn('261025', call['json']['snippet']['title'])
        self.assertEqual(self.row['state'], 'private_uploaded')
        self.assertNotIn('sessionUri', self.row)
        self.youtube.videos().update.assert_not_called()

    def test_unknown_creation_preserves_intent_and_blocks_automatic_retry(self):
        self.session.post.side_effect = OSError('Synthetic lost response')
        with self.assertRaises(OSError):
            self.uploader.upload(self.state, 'c-minjin')
        self.assertEqual(self.row['state'], 'upload_intent')
        self.assertNotIn('sessionUri', self.row)
        self.save.assert_called_once_with(self.state)
        with self.assertRaisesRegex(RuntimeError, '^uncertain_upload_intent_inspect_channel_first$'):
            self.uploader.upload(self.state, 'c-minjin')
        self.session.post.assert_called_once()
        self.session.put.assert_not_called()

    def test_source_verification_failure_prevents_session_creation(self):
        self.uploader.record_source.side_effect = RuntimeError('source_changed')
        with self.assertRaisesRegex(RuntimeError, '^source_changed$'):
            self.uploader.upload(self.state, 'c-minjin')
        self.session.post.assert_not_called()
        self.session.put.assert_not_called()
        self.save.assert_not_called()

    def test_uncertain_upload_intent_never_creates_a_second_session(self):
        self.row['state'] = 'upload_intent'
        with self.assertRaisesRegex(RuntimeError, '^uncertain_upload_intent_inspect_channel_first$'):
            self.uploader.upload(self.state, 'c-minjin')
        self.session.post.assert_not_called()
        self.session.put.assert_not_called()

    def test_visual_review_missing_blocks_before_upload_intent(self):
        self.row['visualReviewPassed'] = False
        with self.assertRaisesRegex(RuntimeError, '^visual_review_required$'):
            self.uploader.upload(self.state, 'c-minjin')
        self.session.post.assert_not_called()
        self.save.assert_not_called()

    def test_identical_cd_content_blocks_before_provider_creation(self):
        self.state['videos']['d-minjin'] = {'source': copy.deepcopy(self.row['source'])}
        with self.assertRaisesRegex(RuntimeError, '^identical_batch_content_requires_review$'):
            self.uploader.upload(self.state, 'c-minjin')
        self.session.post.assert_not_called()
        self.save.assert_not_called()

    def test_exact_existing_channel_title_requires_reconciliation(self):
        self.inventory.return_value = [{'snippet': {'title': self.row['snippet']['title']}}]
        with self.assertRaisesRegex(RuntimeError, '^matching_channel_upload_requires_reconciliation$'):
            self.uploader.upload(self.state, 'c-minjin')
        self.session.post.assert_not_called()
        self.save.assert_not_called()

    def test_resume_probes_same_session_without_another_post(self):
        self.row.update(state='uploading_reconcile_required', sessionUri=baseline.SESSION, uploadedBytes=1024)
        self.uploader.upload(self.state, 'c-minjin')
        self.session.post.assert_not_called()
        self.session.put.assert_called_once_with(baseline.SESSION, headers={
            'Content-Length': '0', 'Content-Range': 'bytes */2048'}, data=b'',
            timeout=60, allow_redirects=False)
        self.assertEqual(self.row['youtubeId'], baseline.VIDEO_ID)


if __name__ == '__main__':
    unittest.main()
