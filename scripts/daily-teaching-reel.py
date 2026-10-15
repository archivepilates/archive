"""Render and upload review-only teaching reels. No public release operation."""
import argparse
from datetime import datetime
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
REFERENCES = Path('/Users/archivepilates/codex-worktrees/reels-local-test-20261009')
JOURNAL = Path.home() / 'Library/Application Support/ARCHIVE PILATES/daily-youtube-reels/state.json'
CHANNEL = 'UCutXw1q-cPB2UbNLnnBMwpw'
TOKEN = Path('/Users/archivepilates/Documents/ARCHIVE-G/.youtube-gcloud/youtube-token.local.json')


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.chmod(0o600)
    temporary.replace(path)


def run(args):
    subprocess.run(args, check=True)


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)
    ], text=True))


def mobile_layout():
    spec = importlib.util.spec_from_file_location('reel_mobile_layout', ROOT / 'scripts/lib/reel-mobile-layout.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def render(plan, folder):
    tail = REFERENCES / 'artifacts/reels-local-test/ending/archive-ending.mp4'
    assert abs(float(probe(tail)['format']['duration']) - 3) < .1
    mobile_layout().render(plan, folder, tail)


def verify(plan, folder):
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw
    movie = folder / 'review-short.mp4'
    p = probe(movie)
    video = next(s for s in p['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in p['streams'] if s['codec_type'] == 'audio')
    duration = float(p['format']['duration'])
    body = plan['end'] - plan['start']
    assert (video['width'], video['height'], video['codec_name'], audio['codec_name']) == (1080, 1920, 'h264', 'aac')
    assert 30 <= duration < 60 and abs(duration - body - 3) < .2
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(movie), '-f', 'null', '-'])
    sheet = Image.new('RGB', (1080, 1320), 'white')
    samples = []
    manifest = load(folder / 'layout-manifest.json')
    layout = mobile_layout()
    assert manifest['version'] == 'mobile-safe-v1' and manifest['footer'] is False
    assert all(layout.within_safe(item['bounds']) for item in manifest['labels'] + manifest['captions'])
    cap = cv2.VideoCapture(str(movie))
    try:
        for i, second in enumerate([.5, body*.2, body*.4, body*.6, body*.85, body+2.5]):
            cap.set(cv2.CAP_PROP_POS_MSEC, second*1000)
            ok, frame = cap.read()
            assert ok
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            if i < 5:
                assert rgb[600:1400].std() > 20
                _, xs = np.where(np.all(rgb[1230:1420] < 100, axis=2))
                assert len(xs) > 300 and xs.min() >= 144 and xs.max() <= 800
                samples.append({'second': second, 'captionX': [int(xs.min()), int(xs.max())]})
            else:
                assert np.sum((rgb[:, :, 0] > 150) & (rgb[:, :, 1] < 80)) > 20000
                ink = np.all(rgb < 100, axis=2) | ((rgb[:, :, 0] > 150) & (rgb[:, :, 1] < 80))
                ys, xs = np.where(ink)
                assert layout.within_safe((int(xs.min()), int(ys.min()), int(xs.max())+1, int(ys.max())+1))
            picture = Image.fromarray(rgb)
            if i == 1:
                picture.save(folder / 'poster.jpg', quality=95)
            sheet.paste(picture.resize((360, 640)), ((i % 3)*360, (i // 3)*660))
            ImageDraw.Draw(sheet).text(((i % 3)*360+10, (i // 3)*660+641), f'{second:.1f}s', fill='black')
    finally:
        cap.release()
    sheet.save(folder / 'contact.jpg', quality=94)
    loudness = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(movie),
        '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True, check=True)
    with Path(plan['source']).open('rb') as stream:
        source_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    assert source_hash == plan['sourceHash']
    with movie.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    result = {'duration': duration, 'sha256': digest, 'sourceUnchanged': True,
              'fullDecode': 'passed', 'captionBounds': samples, 'layoutVersion': manifest['version'],
              'audio': loudness.stderr[loudness.stderr.rfind('Summary:'):].split('[out#')[0]}
    save(folder / 'verification.json', result)
    print(json.dumps(result, ensure_ascii=False), flush=True)


def review_upload(plan, folder):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    verification = load(folder / 'verification.json')
    assert verification['fullDecode'] == 'passed' and verification['sourceUnchanged']
    assert plan['visualReviewPassed'], 'A human-readable contact sheet must be reviewed before upload'
    creds = Credentials.from_authorized_user_file(str(TOKEN))
    if not creds.valid:
        creds.refresh(Request())
    youtube = build('youtube', 'v3', credentials=creds)
    channels = youtube.channels().list(part='snippet', mine=True).execute()['items']
    assert len(channels) == 1 and channels[0]['id'] == CHANNEL
    original = youtube.videos().list(part='snippet', id=plan['sourceYoutubeId']).execute()['items']
    assert len(original) == 1 and original[0]['snippet']['channelId'] == CHANNEL
    assert isinstance(plan.get('selectionReason'), str) and len(plan['selectionReason'].strip()) >= 10
    journal = load(JOURNAL)
    clips = journal['clips']
    row = next((c for c in clips if c.get('clipKey') == plan['clipKey']), None)
    today = datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()
    if row is None:
        assert len([c for c in clips if c.get('productCode') == plan['productCode'] or
                    c.get('sourceYoutubeId') == plan['sourceYoutubeId']]) < 2
        assert not any(c.get('uploadDateKst') == today for c in clips)
        row = {'productCode': plan['productCode'], 'sourceYoutubeId': plan['sourceYoutubeId'],
               'clipKey': plan['clipKey'], 'fileSha256': verification['sha256'],
               'sourceRange': [plan['start'], plan['end']], 'title': plan['title'],
               'sourceTitle': original[0]['snippet']['title'], 'selectionReason': plan['selectionReason'],
               'sourceType': plan.get('sourceType', 'matched external-drive original'),
               'state': 'upload_intent', 'uploadDateKst': today}
        clips.append(row)
        save(JOURNAL, journal)
        request = youtube.videos().insert(part='snippet,status', notifySubscribers=False,
            body={'snippet': {'title': plan['title'], 'description': plan['description'],
                'tags': plan['tags'], 'categoryId': '27', 'defaultLanguage': 'ko', 'defaultAudioLanguage': 'ko'},
                'status': {'privacyStatus': 'private', 'selfDeclaredMadeForKids': False,
                    'embeddable': True, 'license': 'youtube', 'containsSyntheticMedia': False}},
            media_body=MediaFileUpload(str(folder / 'review-short.mp4'), mimetype='video/mp4',
                                     resumable=True, chunksize=8*1024*1024))
        result = None
        while result is None:
            progress, result = request.next_chunk(num_retries=2)
            if progress:
                print(f'UPLOAD {progress.progress():.0%}', flush=True)
        row.update(youtubeId=result['id'], state='private_uploaded')
        save(JOURNAL, journal)
    assert row.get('youtubeId'), 'Unknown upload outcome: inspect channel before retrying'
    assert row['fileSha256'] == verification['sha256']
    video_id = row['youtubeId']
    tracks = youtube.captions().list(part='snippet', videoId=video_id).execute().get('items', [])
    caption = next((t for t in tracks if t['snippet'].get('name') == '한국어 · 티칭 자막'), None)
    if caption is None:
        caption = youtube.captions().insert(part='snippet',
            body={'snippet': {'videoId': video_id, 'language': 'ko', 'name': '한국어 · 티칭 자막', 'isDraft': False}},
            media_body=MediaFileUpload(str(folder / 'captions-reviewed.srt'), mimetype='application/octet-stream')).execute()
    row['captionId'] = caption['id']
    save(JOURNAL, journal)
    deadline = time.monotonic() + 600
    while True:
        current = youtube.videos().list(part='snippet,status,processingDetails,localizations,contentDetails', id=video_id).execute()['items'][0]
        cap = youtube.captions().list(part='snippet', videoId=video_id, id=caption['id']).execute()['items'][0]
        processing = current.get('processingDetails', {}).get('processingStatus')
        serving = cap['snippet']['status']
        if processing == 'failed' or serving == 'failed':
            raise RuntimeError('Video or caption processing failed')
        if processing == 'succeeded' and serving == 'serving':
            break
        if time.monotonic() >= deadline:
            raise TimeoutError('Private processing pending; preserve existing upload')
        print(f'PROCESSING video={processing} caption={serving}', flush=True)
        time.sleep(12)
    localizations = current.get('localizations', {})
    localizations['ja'] = plan['japanese']
    youtube.videos().update(part='localizations', body={'id': video_id, 'localizations': localizations}).execute()
    assert current['status']['privacyStatus'] in ('private', 'unlisted')
    if current['status']['privacyStatus'] == 'private':
        youtube.videos().update(part='status', body={'id': video_id, 'status': {
            'privacyStatus': 'unlisted', 'selfDeclaredMadeForKids': False,
            'embeddable': True, 'license': 'youtube', 'containsSyntheticMedia': False}}).execute()
    fresh = youtube.videos().list(part='snippet,status,processingDetails,localizations,contentDetails', id=video_id).execute()['items'][0]
    assert fresh['status']['privacyStatus'] == 'unlisted'
    assert fresh['snippet']['title'] == plan['title'] and fresh['snippet']['description'] == plan['description']
    assert fresh['snippet']['channelId'] == CHANNEL and fresh['snippet']['defaultAudioLanguage'] == 'ko'
    assert fresh['localizations']['ja'] == plan['japanese']
    row.update(visibility='unlisted', state='review_uploaded', url=f'https://www.youtube.com/shorts/{video_id}',
               processing='succeeded', koreanCaptions='serving', japaneseMetadata='verified')
    save(JOURNAL, journal)
    save(folder / 'youtube-readback.json', fresh)
    print(json.dumps({'videoId': video_id, 'url': row['url'], 'visibility': 'unlisted',
                      'processing': processing, 'captionStatus': serving}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['render', 'verify', 'review-upload'])
    parser.add_argument('plan', type=Path)
    args = parser.parse_args()
    plan = load(args.plan)
    preflight = load(args.plan.parent / 'preflight.json')
    plan.update(source=preflight['source'], sourceHash=preflight['sourceHash'])
    assert re.fullmatch(r'[A-Za-z0-9_-]{11}', plan['sourceYoutubeId'])
    assert re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}', plan['clipKey'])
    folder = args.plan.parent / plan['clipKey'].lower()
    folder.mkdir(exist_ok=True)
    with (JOURNAL.parent / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            {'render': render, 'verify': verify, 'review-upload': review_upload}[args.phase](plan, folder)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
