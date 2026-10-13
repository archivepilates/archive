"""Publish a journaled reel only with independently checked email approval."""
import argparse
from datetime import datetime
from email.utils import parseaddr
import fcntl
import json
from pathlib import Path
import time
from zoneinfo import ZoneInfo

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

JOURNAL = Path.home() / 'Library/Application Support/ARCHIVE PILATES/daily-youtube-reels/state.json'
TOKEN = Path('/Users/archivepilates/Documents/ARCHIVE-G/.youtube-gcloud/youtube-token.local.json')
CHANNEL = 'UCutXw1q-cPB2UbNLnnBMwpw'


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.chmod(0o600)
    temporary.replace(path)


def check_approval(approval, row, journal):
    if approval.get('kind') == 'email-button':
        assert approval['independentlyReadBack'] is True
        assert approval['approverEmail'] == journal['approverEmail']
        assert approval['channelId'] == CHANNEL
        assert approval['videoId'] == row['youtubeId']
        assert approval['fileSha256'] == row['fileSha256']
        assert approval['isTest'] is False and approval['approvedBy'] == 'email-button'
        assert approval['status'] in ('approved', 'published')
        assert type(approval['approvedAt']) is int and type(approval['expiresAt']) is int
        assert 0 < approval['approvedAt'] < approval['expiresAt']
        assert approval['id'] == row['buttonApprovalId']
        assert approval['contentHash'] == row['buttonContentHash']
        return
    request = row['approvalRequest']
    assert approval['independentlyReadBack'] is True
    assert parseaddr(approval['from'])[1].lower() == journal['approverEmail'].lower()
    assert approval['threadId'] == request['threadId']
    assert approval['messageId'] != request['messageId']
    assert approval['requestMessageId'] == request['messageId']
    assert approval['youtubeId'] == row['youtubeId']
    assert approval['newReplyText'].strip() == '승인'
    assert datetime.fromisoformat(approval['sentAt']) >= datetime.fromisoformat(request['sentAt'])


def content_fingerprint(baseline):
    content = {key: baseline['snippet'].get(key) for key in
               ('title', 'description', 'tags', 'categoryId', 'defaultLanguage', 'defaultAudioLanguage')}
    content['localizations'] = baseline.get('localizations', {})
    import hashlib
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def check_content(current, baseline):
    assert current['snippet']['channelId'] == CHANNEL
    # YouTube can regenerate thumbnails and add automatic translations later.
    for key in ('title', 'description', 'tags', 'categoryId', 'defaultLanguage', 'defaultAudioLanguage'):
        assert current['snippet'].get(key) == baseline['snippet'].get(key), key
    for language, content in baseline.get('localizations', {}).items():
        assert current.get('localizations', {}).get(language) == content, language
    assert current['status']['uploadStatus'] == 'processed'
    assert current.get('processingDetails', {}).get('processingStatus') == 'succeeded'


def release_slot(journal, row, today):
    existing = next((p for p in journal['publications'] if p['youtubeId'] == row['youtubeId']), None)
    if existing:
        return existing['dateKst']
    intent = row.get('publicationIntent')
    if intent:
        raise RuntimeError('Uncertain publication intent: reconcile live state before retry')
    assert not any(p['dateKst'] == today for p in journal['publications']), 'Daily release limit reached'
    assert not any(c.get('publicationIntent', {}).get('dateKst') == today for c in journal['clips']), 'Daily release reserved'
    return today


def publish(approval_path, baseline_path):
    approval, baseline = load(approval_path), load(baseline_path)
    with (JOURNAL.parent / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            journal = load(JOURNAL)
            video_id = approval['videoId'] if approval.get('kind') == 'email-button' else approval['youtubeId']
            assert baseline['id'] == video_id
            row = next((c for c in journal['clips'] if c.get('youtubeId') == video_id), None)
            assert row is not None, 'Approved reel missing from canonical journal'
            assert baseline['id'] == row['youtubeId']
            check_approval(approval, row, journal)
            if approval.get('kind') == 'email-button':
                assert approval['contentHash'] == content_fingerprint(baseline)
            credentials = Credentials.from_authorized_user_file(str(TOKEN))
            if not credentials.valid:
                credentials.refresh(Request())
            youtube = build('youtube', 'v3', credentials=credentials)
            channels = youtube.channels().list(part='snippet', mine=True).execute()['items']
            assert len(channels) == 1 and channels[0]['id'] == CHANNEL

            def read():
                return youtube.videos().list(part='snippet,status,processingDetails,localizations,contentDetails',
                                             id=row['youtubeId']).execute()['items'][0]

            current = read()
            check_content(current, baseline)
            today = datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()
            if current['status']['privacyStatus'] == 'public':
                record = next((p for p in journal['publications'] if p['youtubeId'] == row['youtubeId']), None)
                date = record['dateKst'] if record else row.get('publicationIntent', {}).get('dateKst')
                assert date, 'Already public without publication record: manual reconciliation required'
            else:
                assert current['status']['privacyStatus'] == 'unlisted'
                date = release_slot(journal, row, today)
                assert not any(p['youtubeId'] == row['youtubeId'] for p in journal['publications'])
                row['approval'] = approval
                row['publicationIntent'] = {'dateKst': date, 'at': datetime.now(ZoneInfo('UTC')).isoformat()}
                row['state'] = 'publication_intent'
                save(JOURNAL, journal)
                writable = ('license', 'embeddable', 'publicStatsViewable', 'selfDeclaredMadeForKids', 'containsSyntheticMedia')
                status = {k: current['status'][k] for k in writable if k in current['status']}
                status['privacyStatus'] = 'public'
                try:
                    youtube.videos().update(part='status', body={'id': row['youtubeId'], 'status': status}).execute()
                except Exception:
                    row['state'] = 'publication_outcome_unknown'
                    save(JOURNAL, journal)
                    raise
                for attempt in range(6):
                    current = read()
                    if current['status']['privacyStatus'] == 'public':
                        break
                    if attempt < 5:
                        time.sleep(2)
                if current['status']['privacyStatus'] != 'public':
                    row['state'] = 'publication_outcome_unknown'
                    save(JOURNAL, journal)
                    raise RuntimeError('Publication readback pending: reconcile before retry')
                check_content(current, baseline)
            playback = row.get('publicPlaybackVerification', {})
            playback_verified = playback.get('ended') is True and playback.get('error') is None
            row.update(approval=approval, visibility='public',
                       state='public_verified' if playback_verified else 'public_status_verified', publicDateKst=date)
            if not any(p['youtubeId'] == row['youtubeId'] for p in journal['publications']):
                journal['publications'].append({'youtubeId': row['youtubeId'], 'dateKst': date,
                    'approvalMessageId': approval.get('messageId'), 'approvalId': approval.get('id'),
                    'verifiedAt': datetime.now(ZoneInfo('UTC')).isoformat()})
            row.pop('publicationIntent', None)
            journal['lastRun'].update(publicReleases=sum(p['dateKst'] == today for p in journal['publications']),
                                      status='completed_public_verified' if playback_verified else 'public_status_verified_playback_pending')
            save(JOURNAL, journal)
            save(baseline_path.parent / 'youtube-public-readback.json', current)
            print(json.dumps({'id': row['youtubeId'], 'visibility': current['status']['privacyStatus'],
                              'publicDateKst': date, 'url': row['url'], 'approvedContentUnchanged': True}, ensure_ascii=False))
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('approval', type=Path)
    parser.add_argument('baseline', type=Path)
    args = parser.parse_args()
    publish(args.approval, args.baseline)
