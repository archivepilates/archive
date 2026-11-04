"""Update only the product guidance on the two already-public METHOD #9 previews."""
import argparse
import copy
import fcntl
import json
import sys
import hashlib
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

ROOT = Path.home() / 'Library/Application Support/ARCHIVE PILATES/video-sales-improvements-20261103'
JOURNAL = Path.home() / 'Library/Application Support/ARCHIVE PILATES/daily-youtube-reels'
TOKEN = Path('/Users/archivepilates/Documents/ARCHIVE-G/.youtube-gcloud/youtube-token.local.json')
CHANNEL = 'UCutXw1q-cPB2UbNLnnBMwpw'
VIDEOS = {'gZTRX-sd0zQ': ('AB11', 88), 'iRMthLJlooA': ('AR7', 89)}
FIELDS = ['title', 'description', 'categoryId', 'tags', 'defaultLanguage', 'defaultAudioLanguage']

def now():
    return datetime.now(timezone.utc).isoformat()

def save(name, value):
    file = ROOT / name
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    file.chmod(0o600)

def description(before, code, no):
    if '[ARCHIVE METHOD 전체 수업 안내]' in before:
        return before
    guidance = (f'[ARCHIVE METHOD 전체 수업 안내]\n'
                f'이 미리보기의 {code} 풀수업: ARCHIVE PILATES 홈페이지 → 영상구매 → {code}\n'
                f'https://archivepilates.imweb.me/17/?idx={no}&utm_source=youtube&utm_medium=shorts&utm_campaign=method9_{code.lower()}\n'
                '상품 상세에서 관찰 기준·교정 과정·실제 큐잉과 미리보기를 확인할 수 있습니다. 구매 후 40일 시청합니다.\n\n')
    return guidance + before.replace(f'https://archivepilates.imweb.me/shop_view?idx={no}',
                                     f'https://archivepilates.imweb.me/17/?idx={no}')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--browser-session', action='store_true')
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    with (JOURNAL / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.browser_session:
            print(json.dumps({'locked': True, 'scope': list(VIDEOS)}), flush=True)
            for command in sys.stdin:
                if command.strip() == 'quit':
                    break
                code = command.strip()
                assert code in ['AB11', 'AR7']
                proof = json.loads((ROOT / f'{code}-short-browser-proof.json').read_text())
                video_id = next(key for key, value in VIDEOS.items() if value[0] == code)
                assert proof['video'] == video_id and proof['independentReloadVerified'] is True
                assert proof['titleBefore'] == proof['titleAfter']
                assert proof['visibility'] == '공개'
                assert proof['descriptionAfter'] == description(proof['descriptionBefore'], code, VIDEOS[video_id][1])
                journal_file = JOURNAL / 'state.json'
                journal = json.loads(journal_file.read_text())
                rows = [row for row in journal['clips'] if row.get('youtubeId') == video_id]
                assert len(rows) == 1
                events = rows[0].setdefault('postPublicationMetadata', [])
                if not any(event.get('operation') == 'video-sales-20261103' for event in events):
                    events.append({'operation': 'video-sales-20261103', 'at': now(), 'fields': ['description'],
                                   'approval': 'operator-20261103-video-sales-four-improvements',
                                   'proof': str(ROOT / f'{code}-short-browser-proof.json'),
                                   'descriptionSha256': hashlib.sha256(proof['descriptionAfter'].encode()).hexdigest()})
                    temp = journal_file.with_suffix('.json.tmp')
                    temp.write_text(json.dumps(journal, ensure_ascii=False, indent=2))
                    temp.chmod(0o600)
                    temp.replace(journal_file)
                print(json.dumps({'recorded': code, 'video': video_id}), flush=True)
            return
        credentials = Credentials.from_authorized_user_file(str(TOKEN))
        if not credentials.valid:
            credentials.refresh(Request())
        youtube = build('youtube', 'v3', credentials=credentials)
        channels = youtube.channels().list(part='snippet', mine=True).execute()['items']
        assert len(channels) == 1 and channels[0]['id'] == CHANNEL
        def fetch(video_id):
            rows = youtube.videos().list(part='snippet,status,localizations,contentDetails', id=video_id).execute()['items']
            assert len(rows) == 1
            return rows[0]
        for video_id, (code, no) in VIDEOS.items():
            before = fetch(video_id)
            assert before['snippet']['channelId'] == CHANNEL
            assert before['status']['privacyStatus'] == 'public'
            expected = description(before['snippet']['description'], code, no)
            if expected == before['snippet']['description']:
                print(json.dumps({'video': video_id, 'code': code, 'state': 'already_verified_guidance'}))
                continue
            save(f'{code}-short-before.json', before)
            snippet = {key: copy.deepcopy(before['snippet'][key]) for key in FIELDS if key in before['snippet']}
            snippet['description'] = expected
            save(f'{code}-short-plan.json', {'video': video_id, 'snippet': snippet, 'checkedAt': now()})
            if args.apply:
                intent = ROOT / f'{code}-short-intent.json'
                assert not intent.exists(), 'Prior metadata intent must be reconciled, not replayed'
                assert fetch(video_id) == before, 'Concurrent YouTube edit'
                save(intent.name, {'video': video_id, 'at': now(), 'fields': ['snippet.description']})
                youtube.videos().update(part='snippet', body={'id': video_id, 'snippet': snippet}).execute()
                after = fetch(video_id)
                assert after['snippet']['description'] == expected
                for key in FIELDS:
                    if key != 'description':
                        assert after['snippet'].get(key) == before['snippet'].get(key)
                for key in ['status', 'localizations', 'contentDetails']:
                    assert after.get(key) == before.get(key)
                save(f'{code}-short-verified.json', {'verifiedAt': now(), 'video': after})
            print(json.dumps({'video': video_id, 'code': code, 'title': before['snippet']['title'],
                              'state': 'verified' if args.apply else 'planned'}, ensure_ascii=False))

if __name__ == '__main__':
    main()
