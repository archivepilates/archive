"""One approved full-class batch; never publishes or sends member messages."""
import argparse
import fcntl
import hashlib
import json
import os
import stat as stat_module
from pathlib import Path
import re
import subprocess
import time
import unicodedata
from urllib.parse import urlparse

from google.auth.transport.requests import AuthorizedSession, Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

CHANNEL = 'UCutXw1q-cPB2UbNLnnBMwpw'
TOKEN = Path('/Users/archivepilates/Documents/ARCHIVE-G/.youtube-gcloud/youtube-token.local.json')
ROOT = Path.home() / 'Library/Application Support/ARCHIVE PILATES/lesson-videos-261024'
SOURCE = Path('/Volumes/아카아브 2T/아카이브 메소드/#9 외부 피드백2-261024')
FILES = {
    'a-minjin': ('#9 민진 바렐 A.m4v', 'A', '민진', '배민진', '바렐 + 스틱'),
    'b-minjin': ('#9 민진 바렐 B.m4v', 'B', '민진', '배민진', '바렐 + 스틱'),
    'a-eunyeong': ('#9 은영 리포머 A.m4v', 'A', '은영', '정은영', '리포머 + 블럭'),
    'b-eunyeong': ('#9 은영 리포머 B.m4v', 'B', '은영', '정은영', '리포머 + 블럭'),
}


def save(value):
    temporary = ROOT / 'state.json.tmp'
    with temporary.open('w', encoding='utf8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(ROOT / 'state.json')
    directory = os.open(ROOT, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def validate_session(uri):
    parsed = urlparse(uri)
    if (parsed.scheme != 'https' or parsed.hostname != 'www.googleapis.com'
            or parsed.path != '/upload/youtube/v3/videos' or parsed.port not in (None, 443)
            or parsed.username is not None or parsed.password is not None or parsed.fragment):
        raise RuntimeError('unsafe_upload_session')
    return uri


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def source_file(name):
    matches = [p for p in SOURCE.iterdir() if unicodedata.normalize('NFC', p.name) == name]
    if len(matches) != 1 or not matches[0].is_file() or matches[0].is_symlink():
        raise RuntimeError('source_not_unique')
    return matches[0]


def metadata(key):
    name, team, short, instructor, equipment = FILES[key]
    title = f'외부 피드백2 | 261024 · {team}팀 · {short} · {equipment.split(" + ")[0]} · 수강생 공유'
    description = (
        f'ARCHIVE PILATES · ARCHIVE METHOD\n2026년 10월 24일 {team}팀 강사레슨 복습 영상입니다.\n\n'
        f'강사: {instructor} ({short}쌤)\n기구·도구: {equipment}\n주제: 외부 피드백2\n\n'
        f'해당 수업에 참여한 {team}팀 수강생 전용 비판매 콘텐츠입니다.\n'
        '홈페이지에 가입한 뒤 별도 시청 권한이 부여된 계정으로 로그인해 내 강의실에서 시청해 주세요.\n\n'
        '홈페이지: https://archivepilates.com/\n내 강의실: https://archivepilates.imweb.me/48\n'
        '시청 권한 문의: https://pf.kakao.com/_AHdvn/chat\n\n'
        '외부 링크 공유, 저장, 녹화, 복제 및 재배포를 금지합니다.\n'
        '일부공개 영상은 링크를 가진 사람이 볼 수 있으므로 영상 주소를 외부에 전달하지 마세요.\n\n'
        'ARCHIVE PILATES · 부산 명지')
    return {'title': title, 'description': description,
            'tags': ['ARCHIVE PILATES', 'ARCHIVE METHOD', '필라테스 강사레슨', '외부 피드백2',
                     f'{team}팀', '수강생 복습', instructor, *equipment.split(' + ')],
            'categoryId': '27', 'defaultLanguage': 'ko', 'defaultAudioLanguage': 'ko'}


def clients():
    credentials = Credentials.from_authorized_user_file(str(TOKEN))
    if not credentials.valid:
        credentials.refresh(Request())
    youtube = build('youtube', 'v3', credentials=credentials, cache_discovery=False)
    channels = youtube.channels().list(part='snippet,contentDetails', mine=True).execute()['items']
    if len(channels) != 1 or channels[0]['id'] != CHANNEL:
        raise RuntimeError('wrong_channel')
    return youtube, AuthorizedSession(credentials), channels[0]['contentDetails']['relatedPlaylists']['uploads']


def inventory(youtube, playlist):
    items, token = [], None
    while True:
        page = youtube.playlistItems().list(part='snippet,contentDetails', playlistId=playlist,
                                          maxResults=50, pageToken=token).execute()
        items.extend(page.get('items', []))
        token = page.get('nextPageToken')
        if not token:
            return items
        if len(items) > 1000:
            raise RuntimeError('channel_inventory_limit')


def record_source(state, key):
    file = source_file(FILES[key][0])
    stat = file.stat()
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate', '-of', 'json', str(file)]))
    video = next(s for s in probe['streams'] if s.get('codec_name') == 'h264')
    if (video.get('width'), video.get('height')) != (3840, 2160) or float(probe['format']['duration']) < 1800:
        raise RuntimeError('unexpected_source_format')
    value = {'path': str(file), 'size': stat.st_size, 'mtimeNs': stat.st_mtime_ns, 'sha256': digest(file),
             'duration': float(probe['format']['duration'])}
    old = state['videos'].get(key)
    if old and old['source'] != value:
        raise RuntimeError('source_changed')
    if old is None:
        state['videos'][key] = {'source': value, 'snippet': metadata(key), 'state': 'source_verified'}
        save(state)
    return file, state['videos'][key]


def read_response(response, row, state, *, probe=False, start=None, end=None):
    if response.status_code in (200, 201):
        if not probe and end != row['source']['size']:
            raise RuntimeError('premature_completion_requires_review')
        value = response.json()
        if not re.fullmatch(r'[A-Za-z0-9_-]{11}', value.get('id', '')):
            raise RuntimeError('upload_completion_requires_review')
        if value.get('snippet', {}).get('channelId') != CHANNEL:
            raise RuntimeError('uploaded_channel_mismatch')
        row.update(youtubeId=value['id'], state='private_uploaded', uploadedBytes=row['source']['size'])
        row.pop('sessionUri', None)
        save(state)
        return True
    if response.status_code != 308:
        raise RuntimeError(f'upload_http_{response.status_code}_requires_review')
    received = response.headers.get('Range')
    if received and not re.fullmatch(r'bytes=0-\d+', received):
        raise RuntimeError('unexpected_upload_range')
    offset = int(received.split('-')[1]) + 1 if received else 0
    if not 0 <= offset < row['source']['size']:
        raise RuntimeError('invalid_upload_offset')
    if not probe and (start is None or end is None or not start < offset <= end):
        raise RuntimeError('chunk_acknowledgement_requires_reconciliation')
    if probe and offset < row.get('uploadedBytes', 0):
        raise RuntimeError('upload_offset_regressed_requires_review')
    row['uploadedBytes'] = offset
    save(state)
    return False


def upload(state, key):
    youtube, session, playlist = clients()
    file, row = record_source(state, key)
    if row.get('youtubeId'):
        result = youtube.videos().list(part='snippet,status,processingDetails,contentDetails', id=row['youtubeId']).execute()['items']
        if len(result) != 1 or result[0]['snippet']['channelId'] != CHANNEL:
            raise RuntimeError('saved_upload_missing')
        print(json.dumps({'key': key, 'existingId': row['youtubeId'], 'status': result[0]['status']}, ensure_ascii=False))
        return
    if row['state'] == 'upload_intent' and not row.get('sessionUri'):
        raise RuntimeError('uncertain_upload_intent_inspect_channel_first')
    if not row.get('sessionUri'):
        if any(other_key != key and other.get('source', {}).get('sha256') == row['source']['sha256']
               for other_key, other in state['videos'].items()):
            raise RuntimeError('identical_batch_content_requires_review')
        names = {FILES[key][0], Path(FILES[key][0]).stem, row['snippet']['title']}
        candidates = [i for i in inventory(youtube, playlist)
                      if unicodedata.normalize('NFC', i['snippet']['title']) in names]
        if candidates:
            raise RuntimeError('matching_channel_upload_requires_reconciliation')
        if row.get('visualReviewPassed') is not True:
            raise RuntimeError('visual_review_required')
        row.update(state='upload_intent', uploadIntentAt=time.time())
        save(state)
        response = session.post('https://www.googleapis.com/upload/youtube/v3/videos',
            params={'uploadType': 'resumable', 'part': 'snippet,status', 'notifySubscribers': 'false'},
            headers={'X-Upload-Content-Length': str(file.stat().st_size), 'X-Upload-Content-Type': 'video/mp4'},
            json={'snippet': row['snippet'], 'status': {'privacyStatus': 'private', 'embeddable': True,
                'license': 'youtube', 'selfDeclaredMadeForKids': False, 'containsSyntheticMedia': False}},
            timeout=60, allow_redirects=False)
        uri = response.headers.get('Location', '')
        if response.status_code not in (200, 201):
            raise RuntimeError(f'upload_initiation_{response.status_code}_requires_review')
        validate_session(uri)
        row.update(sessionUri=uri, uploadedBytes=0, state='uploading')
        save(state)
    size = row['source']['size']
    query = session.put(validate_session(row['sessionUri']), headers={'Content-Length': '0', 'Content-Range': f'bytes */{size}'},
                        data=b'', timeout=60, allow_redirects=False)
    if read_response(query, row, state, probe=True):
        return
    last_percent = -1
    with file.open('rb') as stream:
        while not row.get('youtubeId'):
            stat = file.stat()
            if stat.st_size != size or stat.st_mtime_ns != row['source']['mtimeNs']:
                raise RuntimeError('source_changed_during_upload')
            offset = row['uploadedBytes']
            stream.seek(offset)
            data = stream.read(8 * 1024 * 1024)
            if not data:
                raise RuntimeError('unexpected_source_end')
            try:
                response = session.put(validate_session(row['sessionUri']), data=data, headers={'Content-Type': 'video/mp4',
                    'Content-Length': str(len(data)), 'Content-Range': f'bytes {offset}-{offset + len(data) - 1}/{size}'},
                    timeout=180, allow_redirects=False)
            except Exception:
                row['state'] = 'uploading_reconcile_required'
                save(state)
                raise RuntimeError('chunk_result_unknown_resume_same_session') from None
            read_response(response, row, state, start=offset, end=offset + len(data))
            percent = int(100 * row['uploadedBytes'] / size)
            if percent // 5 != last_percent // 5:
                print(json.dumps({'key': key, 'percent': percent, 'state': row['state']}, ensure_ascii=False), flush=True)
                last_percent = percent
    if digest(file) != row['source']['sha256']:
        raise RuntimeError('post_upload_source_hash_mismatch')
    print(json.dumps({'key': key, 'youtubeId': row['youtubeId'], 'privateUploadComplete': True}), flush=True)


def share_unlisted(state, key):
    youtube, _, _ = clients()
    row = state['videos'][key]
    video_id = row['youtubeId']
    def read():
        items = youtube.videos().list(part='snippet,status,processingDetails,contentDetails', id=video_id).execute()['items']
        if len(items) != 1 or items[0]['snippet']['channelId'] != CHANNEL:
            raise RuntimeError('sharing_channel_mismatch')
        current = items[0]
        for field in ['title', 'description', 'tags', 'categoryId', 'defaultLanguage', 'defaultAudioLanguage']:
            actual, expected = current['snippet'].get(field), row['snippet'].get(field)
            if field == 'tags' and isinstance(actual, list) and isinstance(expected, list):
                actual, expected = sorted(actual), sorted(expected)
            if actual != expected:
                raise RuntimeError('sharing_metadata_changed')
        return current
    current = read()
    privacy = current['status']['privacyStatus']
    if privacy not in ('private', 'unlisted'):
        raise RuntimeError('unexpected_visibility_no_automatic_change')
    if (current['status'].get('uploadStatus') != 'processed'
            or current.get('processingDetails', {}).get('processingStatus') != 'succeeded'
            or current['status'].get('embeddable') is not True):
        raise RuntimeError('video_processing_or_embedding_not_ready')
    if privacy == 'private':
        if row.get('unlistedIntentAt'):
            raise RuntimeError('prior_sharing_intent_requires_review')
        row['unlistedIntentAt'] = time.time()
        save(state)
        youtube.videos().update(part='status', body={'id': video_id, 'status': {
            'privacyStatus': 'unlisted', 'embeddable': True, 'license': current['status']['license'],
            'selfDeclaredMadeForKids': False}}).execute()
    verified = read()
    if (verified['status']['privacyStatus'] != 'unlisted'
            or verified['status'].get('uploadStatus') != 'processed'
            or verified.get('processingDetails', {}).get('processingStatus') != 'succeeded'
            or verified['status'].get('embeddable') is not True):
        raise RuntimeError('sharing_readback_failed_no_retry')
    row.update(state='unlisted_verified', unlistedVerifiedAt=time.time(),
               url=f'https://www.youtube.com/watch?v={video_id}')
    if row.get('captionReview') in (None, 'pending'):
        row['captionReview'] = 'pending_separate_track_review'
    save(state)
    print(json.dumps({'key': key, 'youtubeId': video_id, 'visibility': 'unlisted',
                      'processing': 'succeeded', 'captionReview': row['captionReview']}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['audit', 'upload-private', 'approve-visual', 'share-unlisted'])
    parser.add_argument('key', choices=list(FILES))
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    stat = ROOT.lstat()
    if ROOT.is_symlink() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise RuntimeError('unsafe_state_directory')
    for path in [ROOT / 'run.lock', ROOT / 'state.json', ROOT / 'state.json.tmp']:
        if path.exists() or path.is_symlink():
            stat = path.lstat()
            if (not stat_module.S_ISREG(stat.st_mode) or stat.st_uid != os.getuid()
                    or stat.st_mode & 0o077):
                raise RuntimeError('unsafe_state_file')
    with (ROOT / 'run.lock').open('a') as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state_path = ROOT / 'state.json'
        state = json.loads(state_path.read_text()) if state_path.exists() else {'version': 1, 'channelId': CHANNEL, 'videos': {}}
        if state.get('channelId') != CHANNEL or state.get('version') != 1:
            raise RuntimeError('wrong_journal')
        if args.action == 'upload-private':
            upload(state, args.key)
        elif args.action == 'share-unlisted':
            share_unlisted(state, args.key)
        else:
            file, row = record_source(state, args.key)
            if args.action == 'approve-visual':
                row['visualReviewPassed'] = True
                save(state)
            print(json.dumps({'key': args.key, 'source': row['source'], 'state': row['state'],
                              'visualReviewPassed': row.get('visualReviewPassed', False)}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'errorType': type(error).__name__,
                          'code': str(error) if type(error) is RuntimeError else 'operation_failed_without_credential_details'}), flush=True)
        raise SystemExit(1)
