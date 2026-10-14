"""Mac mini approval worker. Never creates media or treats email replies as approval."""
import argparse
from datetime import datetime
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import secrets
import subprocess
import sys
import time
import traceback
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('reel_publisher', ROOT / 'scripts/publish-approved-reel.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
STORE = ROOT / 'scripts/reel-approval-store.mjs'


def verify_credentials(video_id=None):
    """Read-only probe for the actual background runtime, without publishing."""
    credentials = publisher.Credentials.from_authorized_user_file(str(publisher.TOKEN))
    if not credentials.valid:
        credentials.refresh(publisher.Request())
    youtube = publisher.build('youtube', 'v3', credentials=credentials)
    channels = youtube.channels().list(part='snippet', mine=True).execute()['items']
    assert len(channels) == 1 and channels[0]['id'] == publisher.CHANNEL
    result = {'ok': True, 'channelVerified': True}
    if video_id:
        journal = publisher.load(publisher.JOURNAL)
        row = next(c for c in journal['clips'] if c.get('youtubeId') == video_id)
        doc = bridge('get', {'id': row['buttonApprovalId']})
        publisher.check_approval({**doc, 'kind': 'email-button', 'independentlyReadBack': True}, row, journal)
        assert publisher.content_fingerprint(doc['contentSnapshot']) == doc['contentHash']
        live = youtube.videos().list(part='snippet,status,processingDetails,localizations', id=video_id).execute()['items'][0]
        publisher.check_content(live, doc['contentSnapshot'])
        result.update(videoId=video_id, approvalStatus=doc['status'], visibility=live['status']['privacyStatus'],
                      contentUnchanged=True)
    return result


def safe_error(error):
    # Do not log exception messages, subprocess output, API bodies or local values.
    return {'errorType': type(error).__name__, 'frames': [
        {'file': Path(frame.filename).name, 'line': frame.lineno, 'function': frame.name}
        for frame in traceback.extract_tb(error.__traceback__)]}


def bridge(action, data=None):
    result = subprocess.run(['node', str(STORE), action], input=json.dumps(data or {}, ensure_ascii=False),
                            capture_output=True, text=True, check=True, timeout=60, cwd=ROOT)
    return json.loads(result.stdout)


def request(video_id, baseline_path):
    with (publisher.JOURNAL.parent / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            journal = publisher.load(publisher.JOURNAL)
            row = next(c for c in journal['clips'] if c.get('youtubeId') == video_id)
            baseline = publisher.load(baseline_path)
            assert baseline['id'] == video_id and baseline['snippet']['channelId'] == publisher.CHANNEL
            assert row.get('visibility') == 'unlisted', 'Only an unlisted review candidate may request approval'
            assert row.get('processing') == 'succeeded' and row.get('koreanCaptions') == 'serving'
            assert row.get('liveVerification', {}).get('error') is None and row.get('liveVerification', {}).get('currentTime', 0) > 5
            assert isinstance(row.get('selectionReason'), str) and len(row['selectionReason'].strip()) >= 10
            credentials = publisher.Credentials.from_authorized_user_file(str(publisher.TOKEN))
            if not credentials.valid:
                credentials.refresh(publisher.Request())
            youtube = publisher.build('youtube', 'v3', credentials=credentials)
            channels = youtube.channels().list(part='snippet', mine=True).execute()['items']
            assert len(channels) == 1 and channels[0]['id'] == publisher.CHANNEL
            live = youtube.videos().list(part='snippet,status,processingDetails,localizations', id=video_id).execute()['items'][0]
            assert live['status']['privacyStatus'] == 'unlisted'
            publisher.check_content(live, baseline)
            content_hash = publisher.content_fingerprint(baseline)
            approval_id = f'{video_id}-{content_hash[:16]}'
            private = publisher.JOURNAL.parent / f'{approval_id}-link.json'
            if private.exists():
                credential = publisher.load(private)
            else:
                credential = {'token': secrets.token_urlsafe(32), 'expiresAt': int(time.time() * 1000) + 7 * 86400000}
                publisher.save(private, credential)
            row.update(buttonApprovalId=approval_id, buttonContentHash=content_hash, state='button_approval_request_intent')
            snapshot = publisher.JOURNAL.parent / f'{approval_id}-snapshot.json'
            publisher.save(snapshot, baseline)
            row['buttonSnapshotPath'] = str(snapshot)
            publisher.save(publisher.JOURNAL, journal)
            receipt = bridge('request', {'id': approval_id, 'videoId': video_id, 'channelId': publisher.CHANNEL,
                'title': row['title'], 'fileSha256': row['fileSha256'], 'contentHash': content_hash,
                'contentSnapshot': baseline, 'token': credential['token'],
                'tokenHash': hashlib.sha256(credential['token'].encode()).hexdigest(), 'expiresAt': credential['expiresAt'],
                'isTest': False, 'reviewSummary': f"원본: {row.get('sourceTitle', row['productCode'])} ({row['productCode']})\n선택 구간(초): {row.get('sourceRange', [])}\n길이: {row['liveVerification'].get('duration', 0):.1f}초\n선정 이유: {row['selectionReason']}\n소스: {row.get('sourceType', 'verified original')}\n검증: 실제 재생·자막·음량·프레이밍·공식 엔딩 확인"})
            row.update(state='button_approval_requested', approvalRequest={'kind': 'email-button',
                'approvalId': approval_id, 'messageId': receipt['messageId'], 'threadId': receipt.get('threadId'),
                'to': journal['approverEmail'], 'sentAt': datetime.now(ZoneInfo('UTC')).isoformat(), 'verifiedSent': True})
            publisher.save(publisher.JOURNAL, journal)
            return {'videoId': video_id, 'approvalId': approval_id, 'messageId': receipt['messageId'], 'state': row['state']}
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def process():
    with (publisher.JOURNAL.parent / 'worker.lock').open('a') as worker_lock:
        try:
            fcntl.flock(worker_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'skipped': 'worker_busy'}
        try:
            for row in publisher.load(publisher.JOURNAL)['clips']:
                if row.get('state') == 'button_approval_request_intent' and row.get('buttonSnapshotPath'):
                    request(row['youtubeId'], Path(row['buttonSnapshotPath']))
            docs = sorted(bridge('list'), key=lambda d: d['approvedAt'])
            health = publisher.load(publisher.JOURNAL).get('buttonWorkerHealth', {})
            youtube_checked = False
            released = 0
            for doc in docs:
                journal = publisher.load(publisher.JOURNAL)
                row = next((c for c in journal['clips'] if c.get('youtubeId') == doc['videoId']), None)
                if not row or row.get('buttonApprovalId') != doc['id']:
                    raise RuntimeError('Approved reel is missing from the canonical journal')
                approval = {**doc, 'kind': 'email-button', 'independentlyReadBack': True}
                publisher.check_approval(approval, row, journal)
                baseline = doc['contentSnapshot']
                assert publisher.content_fingerprint(baseline) == doc['contentHash']
                today = datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()
                prior = next((p for p in journal['publications'] if p['youtubeId'] == row['youtubeId']), None)
                if not prior and any(p['dateKst'] == today for p in journal['publications']):
                    break
                folder = publisher.JOURNAL.parent / 'approved' / doc['id']
                folder.mkdir(parents=True, exist_ok=True, mode=0o700)
                publisher.save(folder / 'approval.json', approval)
                publisher.save(folder / 'baseline.json', baseline)
                publisher.publish(folder / 'approval.json', folder / 'baseline.json')
                youtube_checked = True
                journal = publisher.load(publisher.JOURNAL)
                row = next(c for c in journal['clips'] if c.get('youtubeId') == doc['videoId'])
                assert row['visibility'] == 'public'
                bridge('complete', {'id': doc['id'], 'contentHash': doc['contentHash'], 'videoId': doc['videoId'],
                                    'publicDateKst': row['publicDateKst']})
                if not row.get('releaseConfirmation', {}).get('sentReadbackVerified'):
                    receipt = bridge('notice', {'eventKey': f"reel-public/{doc['id']}/v1", 'statusLabel': '자동화 성공',
                        'subject': f"Re: {doc['requestSubject']}", 'replyMessageId': doc['requestMessageId'],
                        'body': f"주체: ARCHIVE PILATES / 릴스 백그라운드 공개\n결론: 승인하신 영상을 전체공개로 전환했습니다.\n영상: {row['url']}\n검증: 공식 채널의 공개 상태 재조회 및 승인된 제목·설명 보존 확인. 업로드 당시 실제 재생·자막·음량 검증을 통과한 영상입니다.\n주의: 하루 최대 한 편 공개 제한 유지.\n다음: 없음."})
                    assert isinstance(receipt.get('messageId'), str) and receipt['messageId'].strip(), 'Notice delivery unconfirmed'
                    with (publisher.JOURNAL.parent / 'run.lock').open('a') as lock:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        try:
                            journal = publisher.load(publisher.JOURNAL)
                            row = next(c for c in journal['clips'] if c.get('youtubeId') == doc['videoId'])
                            row['releaseConfirmation'] = {**receipt, 'sentReadbackVerified': True}
                            publisher.save(publisher.JOURNAL, journal)
                        finally:
                            fcntl.flock(lock, fcntl.LOCK_UN)
                bridge('finish-notice', {'id': doc['id'], 'contentHash': doc['contentHash'],
                    'messageId': row['releaseConfirmation']['messageId']})
                released += not bool(prior)
            # Empty or daily-capped queues must not conceal failed YouTube access.
            if health.get('failures', 0) and not youtube_checked:
                verify_credentials()
            return {'ok': True, 'approvedWaiting': len(docs), 'publicReleases': released}
        finally:
            fcntl.flock(worker_lock, fcntl.LOCK_UN)


def report_health(ok, error=None):
    with (publisher.JOURNAL.parent / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            journal = publisher.load(publisher.JOURNAL)
            health = journal.setdefault('buttonWorkerHealth', {'failures': 0})
            if ok and health['failures'] == 0:
                return
            health['failures'] = 0 if ok else health['failures'] + 1
            if not ok and error is not None:
                health['lastError'] = safe_error(error)
                health['lastErrorAt'] = datetime.now(ZoneInfo('UTC')).isoformat()
            if ok and health.get('noticeSent'):
                bridge('notice', {'eventKey': f"reel-worker-recovered/{health['firstFailure']}",
                    'subject': '[릴스][성공] 승인 공개 처리기 복구',
                    'body': '주체: ARCHIVE PILATES / 릴스 백그라운드 공개\n결론: 승인 공개 처리기의 전체 확인이 정상 완료됐습니다.\n주의: 개별 영상의 과거 누락 처리 완료를 의미하지 않습니다.\n다음: 없음.'})
                journal['buttonWorkerHealth'] = {'failures': 0}
            if not ok and health['failures'] >= 3 and not health.get('noticeSent'):
                first = health.setdefault('firstFailure', datetime.now(ZoneInfo('UTC')).isoformat())
                receipt = bridge('notice', {'eventKey': f'reel-worker-failure/{first}',
                    'subject': '[릴스][실패] 승인 공개 처리 확인 필요',
                    'body': '주체: ARCHIVE PILATES / 릴스 백그라운드 공개\n결론: 승인 공개 확인이 3회 연속 완료되지 않았습니다.\n영향: 승인된 영상의 공개 또는 완료 알림이 지연될 수 있습니다.\n조치: 기존 영상·메일을 재등록하지 않고 원장과 유튜브 상태를 대조해야 합니다.\n다음: 승인 처리기 인증·원장·공개 상태 확인.'})
                health['noticeSent'] = receipt['messageId']
            publisher.save(publisher.JOURNAL, journal)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['request', 'process', 'verify-credentials'])
    parser.add_argument('--video-id')
    parser.add_argument('--baseline', type=Path)
    args = parser.parse_args()
    try:
        if args.action == 'verify-credentials':
            print(json.dumps(verify_credentials(args.video_id)))
        elif args.action == 'request':
            assert args.video_id and args.baseline
            print(json.dumps(request(args.video_id, args.baseline), ensure_ascii=False))
        else:
            result = process()
            if not result.get('skipped'):
                report_health(True)
            if result.get('publicReleases'):
                print(json.dumps(result))
    except BlockingIOError:
        pass
    except Exception as error:
        if args.action == 'process':
            try:
                report_health(False, error)
            except Exception:
                pass
        print(json.dumps({'at': datetime.now(ZoneInfo('UTC')).isoformat(), **safe_error(error)}), file=sys.stderr)
        sys.exit(1)
