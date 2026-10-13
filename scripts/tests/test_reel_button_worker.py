"""Offline approval/publication regressions; never run either production CLI."""

import argparse
import copy
from datetime import datetime, timezone
import fcntl
import importlib.util
import io
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from types import ModuleType
import unittest
from unittest import mock
from zoneinfo import ZoneInfo


SCRIPTS = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 14, 3, tzinfo=timezone.utc)
VIDEO = 'fixture0001'
# Preload the timezone extension before restoring the patched module registry.
KST = ZoneInfo('Asia/Seoul')
TODAY = NOW.astimezone(KST).date().isoformat()


class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)


def import_scripts():
    # Stub Google modules before import, including on machines without the SDK.
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
    credentials = mock.Mock(name='Credentials')
    build = mock.Mock(name='build', side_effect=AssertionError('Unmocked API'))
    request = mock.Mock(name='Request', side_effect=AssertionError('Token refresh'))
    modules['google.oauth2.credentials'].Credentials = credentials
    modules['googleapiclient.discovery'].build = build
    modules['google.auth.transport.requests'].Request = request

    def load(name, filename):
        spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    with mock.patch.dict(sys.modules, modules), mock.patch.object(
        argparse, 'ArgumentParser', side_effect=AssertionError('CLI executed')
    ) as parser, mock.patch.object(
        subprocess, 'run', side_effect=AssertionError('Bridge executed on import')
    ) as command:
        publisher = load('offline_reel_publisher', 'publish-approved-reel.py')
        worker = load('offline_reel_worker', 'reel-button-worker.py')
    parser.assert_not_called()
    command.assert_not_called()
    credentials.from_authorized_user_file.assert_not_called()
    build.assert_not_called()
    request.assert_not_called()
    return publisher, worker


def reverse_dicts(value):
    if isinstance(value, dict):
        return {key: reverse_dicts(value[key]) for key in reversed(value)}
    if isinstance(value, list):
        return [reverse_dicts(item) for item in value]
    return value


class ReelButtonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='reel-button-unittest-')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.publisher, self.worker = import_scripts()

        def patch(target, name, **kwargs):
            patcher = mock.patch.object(target, name, **kwargs)
            value = patcher.start()
            self.addCleanup(patcher.stop)
            return value

        patch(self.worker, 'publisher', new=self.publisher)
        patch(self.publisher, 'JOURNAL', new=self.folder / 'state.json')
        patch(self.publisher, 'TOKEN', new=self.folder / 'never-created-token.json')
        patch(self.publisher, 'datetime', new=FrozenDatetime)
        patch(self.worker, 'datetime', new=FrozenDatetime)
        self.bridge = patch(self.worker, 'bridge', side_effect=self.bridge_response)
        self.command = patch(subprocess, 'run', side_effect=AssertionError('External command'))
        patch(subprocess, 'Popen', side_effect=AssertionError('External process'))
        patch(socket.socket, 'connect', side_effect=AssertionError('External network'))
        self.output = patch(sys, 'stdout', new=io.StringIO())
        self.sleep = patch(self.publisher.time, 'sleep', side_effect=AssertionError('Unexpected wait'))
        self.credentials = patch(self.publisher, 'Credentials')
        self.credentials.from_authorized_user_file.return_value.valid = True
        self.auth_request = patch(self.publisher, 'Request', side_effect=AssertionError('Token refresh'))
        self.youtube = mock.Mock(name='youtube')
        self.build = patch(self.publisher, 'build', return_value=self.youtube)
        self.youtube.channels.return_value.list.return_value.execute.return_value = {
            'items': [{'id': self.publisher.CHANNEL}],
        }
        self.youtube.videos.return_value.list.return_value.execute.side_effect = self.read_video
        self.youtube.videos.return_value.update.return_value.execute.side_effect = self.make_public
        self.baseline = {
            'id': VIDEO,
            'snippet': {
                'channelId': self.publisher.CHANNEL, 'title': 'ARCHIVE PILATES fixture',
                'description': 'Offline approved snapshot', 'tags': ['fixture', 'lesson'],
                'categoryId': '27', 'defaultLanguage': 'ko', 'defaultAudioLanguage': 'ko',
            },
            'localizations': {
                'ko': {'title': 'Fixture KO', 'description': 'Description KO'},
                'en': {'title': 'Fixture EN', 'description': 'Description EN'},
            },
            'status': {'privacyStatus': 'unlisted', 'uploadStatus': 'processed',
                       'selfDeclaredMadeForKids': False, 'embeddable': True},
            'processingDetails': {'processingStatus': 'succeeded'},
        }
        self.current = copy.deepcopy(self.baseline)
        self.hash = self.publisher.content_fingerprint(self.baseline)
        self.approval_id = VIDEO + '-' + self.hash[:16]
        self.journal = {
            'approverEmail': 'operator@example.invalid',
            'clips': [{'youtubeId': VIDEO, 'fileSha256': 'a' * 64,
                       'buttonApprovalId': self.approval_id, 'buttonContentHash': self.hash,
                       'title': self.baseline['snippet']['title'],
                       'url': 'https://example.invalid/fixture',
                       'state': 'button_approval_requested', 'visibility': 'unlisted'}],
            'publications': [], 'lastRun': {},
        }
        self.doc = {
            'id': self.approval_id, 'videoId': VIDEO, 'channelId': self.publisher.CHANNEL,
            'fileSha256': 'a' * 64, 'contentHash': self.hash,
            'contentSnapshot': copy.deepcopy(self.baseline), 'isTest': False,
            'approvedBy': 'email-button', 'status': 'approved',
            'approverEmail': self.journal['approverEmail'],
            'approvedAt': int(NOW.timestamp() * 1000) - 1000,
            'expiresAt': int(NOW.timestamp() * 1000) + 86400000,
            'requestSubject': '[Fixture] approval', 'requestMessageId': 'fixture-request',
        }
        self.approval_path = self.folder / 'approval.json'
        self.baseline_path = self.folder / 'baseline.json'
        self.publisher.save(self.publisher.JOURNAL, self.journal)
        self.publisher.save(self.baseline_path, self.baseline)
        self.notice_receipt = {'messageId': 'fixture-notice', 'threadId': 'fixture-thread'}

    def tearDown(self):
        self.command.assert_not_called()
        self.auth_request.assert_not_called()
        self.sleep.assert_not_called()
        self.assertFalse(self.publisher.TOKEN.exists())
        # These are real, temporary canonical locks, not mocked flock calls.
        for name in ('run.lock', 'worker.lock'):
            path = self.folder / name
            if path.exists():
                with path.open('a') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    fcntl.flock(lock, fcntl.LOCK_UN)

    def approval(self, **changes):
        return {**copy.deepcopy(self.doc), 'kind': 'email-button',
                'independentlyReadBack': True, **changes}

    def publisher_approval(self, **changes):
        return self.approval(**changes)

    def write_approval(self, approval=None):
        self.publisher.save(self.approval_path, approval or self.publisher_approval())

    def saved_journal(self):
        return self.publisher.load(self.publisher.JOURNAL)

    def read_video(self):
        return {'items': [copy.deepcopy(self.current)]}

    def make_public(self):
        intent = self.saved_journal()['clips'][0]
        self.assertEqual(intent['state'], 'publication_intent')
        self.assertEqual(intent['publicationIntent']['dateKst'], TODAY)
        self.current['status']['privacyStatus'] = 'public'
        return copy.deepcopy(self.current)

    def bridge_response(self, action, data=None):
        if action == 'list':
            return [copy.deepcopy(self.doc)]
        if action == 'complete':
            self.assertEqual(self.current['status']['privacyStatus'], 'public')
            self.doc['status'] = 'published'
            return {'ok': True}
        if action == 'notice':
            return copy.deepcopy(self.notice_receipt)
        if action == 'finish-notice':
            row = self.saved_journal()['clips'][0]
            self.assertTrue(row['releaseConfirmation']['sentReadbackVerified'])
            self.assertEqual(data['messageId'], self.notice_receipt['messageId'])
            return {'ok': True}
        self.fail('Unexpected bridge action: ' + action)

    def bridge_actions(self):
        return [call.args[0] for call in self.bridge.call_args_list]

    def test_imports_do_not_execute_cli_or_contact_services(self):
        self.assertTrue(callable(self.publisher.publish))
        self.assertTrue(callable(self.worker.process))
        self.build.assert_not_called()
        self.bridge.assert_not_called()

    def test_email_button_accepts_exact_approved_or_published_proof(self):
        for status in ('approved', 'published'):
            with self.subTest(status=status):
                self.publisher.check_approval(self.approval(status=status),
                                              self.journal['clips'][0], self.journal)

    def test_mismatched_email_button_proof_rejects_before_publication(self):
        bad_proofs = (
            {'videoId': 'other000001'}, {'channelId': 'wrong-channel'},
            {'contentHash': 'b' * 64}, {'fileSha256': 'b' * 64}, {'isTest': True},
            {'isTest': 0}, {'approvedAt': 0}, {'approvedAt': -1},
            {'approvedAt': self.doc['expiresAt']},
            {'approvedAt': self.doc['expiresAt'] + 1}, {'approvedAt': '123'},
            {'approvedAt': 1.5}, {'id': 'wrong-approval'},
            {'approvedBy': 'email-reply'}, {'status': 'pending'},
            {'approverEmail': 'other@example.invalid'}, {'independentlyReadBack': False},
        )
        for changes in bad_proofs:
            with self.subTest(changes=changes):
                self.write_approval(self.publisher_approval(**changes))
                with self.assertRaises(AssertionError):
                    self.publisher.publish(self.approval_path, self.baseline_path)
                self.assertEqual(self.saved_journal(), self.journal)
        self.credentials.from_authorized_user_file.assert_not_called()
        self.build.assert_not_called()
        self.assertFalse((self.folder / 'youtube-public-readback.json').exists())

    def test_boolean_is_not_a_valid_approval_timestamp(self):
        with self.assertRaises(AssertionError):
            self.publisher.check_approval(self.approval(approvedAt=True),
                                          self.journal['clips'][0], self.journal)

    def test_approved_snapshot_fingerprint_ignores_dictionary_order(self):
        reordered = reverse_dicts(self.baseline)
        self.assertNotEqual(list(reordered['snippet']), list(self.baseline['snippet']))
        self.assertEqual(self.publisher.content_fingerprint(reordered), self.hash)
        changed = copy.deepcopy(reordered)
        changed['snippet']['title'] = 'Changed after approval'
        self.assertNotEqual(self.publisher.content_fingerprint(changed), self.hash)

    def test_snapshot_tampering_rejects_even_when_proof_matches_journal(self):
        changed = copy.deepcopy(self.baseline)
        changed['snippet']['description'] = 'Not approved'
        self.publisher.save(self.baseline_path, changed)
        self.write_approval()
        with self.assertRaises(AssertionError):
            self.publisher.publish(self.approval_path, self.baseline_path)
        self.build.assert_not_called()
        self.credentials.from_authorized_user_file.assert_not_called()
        self.assertEqual(self.saved_journal(), self.journal)

    def test_worker_rejects_mismatched_proof_before_publication(self):
        with mock.patch.object(self.publisher, 'publish') as publish:
            for changes in ({'videoId': 'other000001'}, {'channelId': 'wrong'},
                            {'contentHash': 'b' * 64}, {'fileSha256': 'b' * 64},
                            {'isTest': True}, {'approvedAt': 0}):
                with self.subTest(changes=changes):
                    self.bridge.return_value = [{**self.doc, **changes}]
                    self.bridge.side_effect = None
                    with self.assertRaises((AssertionError, RuntimeError)):
                        self.worker.process()
            publish.assert_not_called()
        self.build.assert_not_called()
        self.assertEqual(self.saved_journal(), self.journal)

    def test_publisher_caps_another_public_reel_today(self):
        self.journal['publications'] = [{'youtubeId': 'other000001', 'dateKst': TODAY}]
        self.publisher.save(self.publisher.JOURNAL, self.journal)
        self.write_approval()
        with self.assertRaisesRegex(AssertionError, 'Daily release limit'):
            self.publisher.publish(self.approval_path, self.baseline_path)
        self.youtube.videos.return_value.update.assert_not_called()
        self.assertEqual(self.saved_journal(), self.journal)

    def test_worker_noops_when_another_reel_is_already_public_today(self):
        self.journal['publications'] = [{'youtubeId': 'other000001', 'dateKst': TODAY}]
        self.publisher.save(self.publisher.JOURNAL, self.journal)
        with mock.patch.object(self.publisher, 'publish') as publish:
            self.assertEqual(self.worker.process(),
                             {'ok': True, 'approvedWaiting': 1, 'publicReleases': 0})
            publish.assert_not_called()
        self.assertEqual(self.bridge_actions(), ['list'])
        self.build.assert_not_called()
        self.assertEqual(self.saved_journal(), self.journal)
        self.assertFalse((self.folder / 'approved').exists())

    def test_reserved_or_uncertain_publication_cannot_get_a_second_slot(self):
        self.journal['clips'].append({'youtubeId': 'other000001',
                                     'publicationIntent': {'dateKst': TODAY}})
        with self.assertRaisesRegex(AssertionError, 'Daily release reserved'):
            self.publisher.release_slot(self.journal, self.journal['clips'][0], TODAY)
        self.journal['clips'][0]['publicationIntent'] = {'dateKst': TODAY}
        with self.assertRaisesRegex(RuntimeError, 'Uncertain publication intent'):
            self.publisher.release_slot(self.journal, self.journal['clips'][0], TODAY)

    def test_missing_canonical_row_never_publishes(self):
        self.journal['clips'] = []
        self.publisher.save(self.publisher.JOURNAL, self.journal)
        self.write_approval()
        with self.assertRaisesRegex(AssertionError, 'canonical journal'):
            self.publisher.publish(self.approval_path, self.baseline_path)
        with mock.patch.object(self.publisher, 'publish') as publish:
            with self.assertRaisesRegex(RuntimeError, 'canonical journal'):
                self.worker.process()
            publish.assert_not_called()
        self.credentials.from_authorized_user_file.assert_not_called()
        self.build.assert_not_called()
        self.assertEqual(self.bridge_actions(), ['list'])
        self.assertEqual(self.saved_journal(), self.journal)

    def test_bridge_video_id_schema_can_reach_publisher(self):
        # Real approval documents use videoId, not youtubeId. This regression
        # must stay compatible with the publication entry point.
        self.assertNotIn('youtubeId', self.doc)
        with mock.patch.object(self.publisher, 'publish', wraps=self.publisher.publish):
            result = self.worker.process()
        self.assertEqual(result['publicReleases'], 1)
        self.youtube.videos.return_value.update.assert_called_once()

    def enable_legacy_alias_for_notice_tests(self):
        # Isolate notice/retry behavior from the independently tested ID defect.
        self.doc['youtubeId'] = VIDEO

    def test_notice_retry_after_public_publication_does_not_republish(self):
        self.enable_legacy_alias_for_notice_tests()
        response = self.bridge_response
        attempts = 0

        def bridge(action, data=None):
            nonlocal attempts
            if action == 'notice':
                attempts += 1
                if attempts == 1:
                    raise RuntimeError('Fixture receipt readback failed')
            return response(action, data)

        self.bridge.side_effect = bridge
        with mock.patch.object(self.publisher, 'publish', wraps=self.publisher.publish) as publish:
            with self.assertRaisesRegex(RuntimeError, 'receipt readback failed'):
                self.worker.process()
            after_failure = self.saved_journal()
            self.assertEqual(after_failure['clips'][0]['visibility'], 'public')
            self.assertEqual(len(after_failure['publications']), 1)
            self.assertNotIn('releaseConfirmation', after_failure['clips'][0])
            self.assertNotIn('finish-notice', self.bridge_actions())
            result = self.worker.process()
            self.assertEqual(publish.call_count, 2)
        self.assertEqual(result['publicReleases'], 0)
        self.youtube.videos.return_value.update.assert_called_once_with(
            part='status', body={'id': VIDEO, 'status': {
                'embeddable': True, 'selfDeclaredMadeForKids': False, 'privacyStatus': 'public'}},
        )
        self.assertEqual(len(self.saved_journal()['publications']), 1)
        self.assertEqual(self.bridge_actions(),
                         ['list', 'complete', 'notice', 'list', 'complete', 'notice', 'finish-notice'])
        notices = [call.args[1] for call in self.bridge.call_args_list if call.args[0] == 'notice']
        self.assertEqual(notices[0]['eventKey'], notices[1]['eventKey'])

    def test_finish_notice_happens_only_after_successful_receipt_is_saved(self):
        self.enable_legacy_alias_for_notice_tests()
        with mock.patch.object(self.publisher, 'publish', wraps=self.publisher.publish):
            result = self.worker.process()
        self.assertEqual(result['publicReleases'], 1)
        self.assertEqual(self.bridge_actions(), ['list', 'complete', 'notice', 'finish-notice'])
        confirmation = self.saved_journal()['clips'][0]['releaseConfirmation']
        self.assertEqual(confirmation, {**self.notice_receipt, 'sentReadbackVerified': True})

    def test_missing_receipt_does_not_mark_notice_verified_or_finished(self):
        self.enable_legacy_alias_for_notice_tests()
        self.notice_receipt = {}
        with mock.patch.object(self.publisher, 'publish', wraps=self.publisher.publish):
            with self.assertRaises((KeyError, RuntimeError, AssertionError)):
                self.worker.process()
        self.assertNotIn('finish-notice', self.bridge_actions())
        row = self.saved_journal()['clips'][0]
        self.assertFalse(row.get('releaseConfirmation', {}).get('sentReadbackVerified'))

    def test_finish_notice_retry_reuses_saved_receipt_without_resend_or_republish(self):
        self.enable_legacy_alias_for_notice_tests()
        response = self.bridge_response
        attempts = 0

        def bridge(action, data=None):
            nonlocal attempts
            if action == 'finish-notice':
                attempts += 1
                if attempts == 1:
                    raise RuntimeError('Fixture finish acknowledgement failed')
            return response(action, data)

        self.bridge.side_effect = bridge
        with mock.patch.object(self.publisher, 'publish', wraps=self.publisher.publish):
            with self.assertRaisesRegex(RuntimeError, 'finish acknowledgement failed'):
                self.worker.process()
            self.assertTrue(self.saved_journal()['clips'][0]['releaseConfirmation']['sentReadbackVerified'])
            self.assertEqual(self.worker.process()['publicReleases'], 0)
        self.youtube.videos.return_value.update.assert_called_once()
        self.assertEqual(self.bridge_actions().count('notice'), 1)
        self.assertEqual(self.bridge_actions().count('finish-notice'), 2)
        self.assertEqual(len(self.saved_journal()['publications']), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
