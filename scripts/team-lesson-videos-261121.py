"""Private-first upload for the two verified 2026-11-21 Team lessons."""

import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timedelta


ROOT = Path.home() / 'archive-automation/operations/team-lesson-videos-261121'
BASE = Path(__file__).resolve().parent
SOURCE = Path('/Volumes/아카아브 2T/아카이브 메소드/팀강사레슨 1121')
FILES = {
    'eunyeong-reformer': ('은영 리포머.m4v', 'Team', '은영', '정은영', '리포머 + 블럭', '98585018'),
    'minjin-chair': ('민진 체어.m4v', 'Team', '민진', '배민진', '체어', '98585168'),
}
ORTHOGRAPHY = {
    'eunyeong-reformer': (('푸바', '풋바'), ('아무쿠렌', '아웃 프레임'), ('게리지', '캐리지'),
                         ('쇼더블럭', '숄더 블럭')),
    'minjin-chair': (('패달', '페달'),),
}


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), BASE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def metadata(key):
    _, _, short, instructor, gear, _ = FILES[key]
    return {
        'title': f'ARCHIVE METHOD #9 외부 피드백2 | 261121 · Team 강사레슨 · {short} · {gear} · 수강생 공유',
        'description': (
            'ARCHIVE PILATES · ARCHIVE METHOD\n2026년 11월 21일 Team 강사레슨 복습 영상입니다.\n\n'
            f'강사: {instructor}\n기구·도구: {gear}\n주제: ARCHIVE METHOD #9 외부 피드백2\n\n'
            '이 회차 등록 수강생을 위한 비판매 영상입니다. 시청 권한이 부여된 계정으로 홈페이지에 로그인한 뒤 내 강의실에서 확인해 주세요.\n'
            '시청 기간은 처음 권한이 부여된 시점부터 40일입니다.\n\n'
            '홈페이지: https://archivepilates.com/\n내 강의실: https://archivepilates.imweb.me/48\n'
            '권한 문의: https://pf.kakao.com/_AHdvn/chat\n\n'
            '일부공개 영상의 주소를 외부로 전달하지 마세요. 저장, 녹화, 복제, 재배포는 금지합니다.'),
        'tags': ['ARCHIVE PILATES', 'ARCHIVE METHOD', '필라테스 강사레슨', 'Team 강사레슨',
                 '외부 피드백2', '수강생 복습', instructor, *gear.split(' + ')],
        'categoryId': '27', 'defaultLanguage': 'ko', 'defaultAudioLanguage': 'ko',
    }


def japanese(key):
    teacher, gear = ('チョン・ウニョン', 'リフォーマー＋ブロック') if key == 'eunyeong-reformer' else ('ペ・ミンジン', 'チェア')
    return {
        'title': f'ARCHIVE METHOD #9 外部フィードバック2｜261121 Team指導者レッスン｜{teacher}・{gear}｜受講者向け',
        'description': (
            'ARCHIVE PILATES · ARCHIVE METHOD\n2026年11月21日 Team指導者レッスンの復習用動画です。\n\n'
            f'講師：{teacher}\n器具・用具：{gear}\nテーマ：ARCHIVE METHOD #9 外部フィードバック2\n\n'
            'この回に登録された受講者向けの非売品です。視聴権限が付与されたアカウントでログインし、「マイ教室」からご覧ください。\n'
            '視聴期間は初回の権限付与から40日間です。\n\n'
            '公式サイト：https://archivepilates.com/\nマイ教室：https://archivepilates.imweb.me/48\n'
            'お問い合わせ：https://pf.kakao.com/_AHdvn/chat\n\n'
            '限定公開リンクの外部共有、保存、録画、複製、再配布はご遠慮ください。'),
    }


def video_state(module, row):
    youtube, _, _ = module.clients()
    rows = youtube.videos().list(part='snippet,status,processingDetails,localizations,contentDetails',
                                 id=row['youtubeId']).execute()['items']
    if len(rows) != 1 or rows[0]['snippet']['channelId'] != module.CHANNEL:
        raise RuntimeError('channel_readback_failed')
    return youtube, rows[0]


def checked_source(module, row, key):
    file = module.source_file(FILES[key][0])
    stat = file.stat()
    if (str(file), stat.st_size, stat.st_mtime_ns) != tuple(row['source'][k] for k in ('path', 'size', 'mtimeNs')):
        raise RuntimeError('source_changed')
    return file


def caption_draft(module, key):
    import mlx_whisper
    import srt

    review = load('review-lesson-261025-captions.py')
    row = json.loads(review.private_read(ROOT / 'state.json'))['videos'][key]
    source = checked_source(module, row, key)
    if not row.get('fullDecodePassed'):
        raise RuntimeError('source_verification_incomplete')
    folder = ROOT / 'captions' / key
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (folder / 'draft.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (folder / 'draft.json').exists() or (folder / 'draft.srt').exists():
            raise RuntimeError('existing_caption_draft_no_overwrite')
        model = SOURCE.parents[1] / ('ARCHIVE PILATES/models/huggingface/hub/models--mlx-community--whisper-large-v3-mlx/'
                                    'snapshots/49e6aa286ad60c14352c404340ded53710378a11')
        if not model.is_dir():
            raise RuntimeError('existing_local_caption_model_missing')
        text = mlx_whisper.transcribe(str(source), path_or_hf_repo=str(model), language='ko', verbose=None,
            condition_on_previous_text=False, initial_prompt='아카이브 메소드 팀 강사레슨 외부 피드백2, 리포머, 블럭, 체어, 흉곽, 골반, 발목, 큐잉.')
        checked_source(module, row, key)
        end = timedelta(seconds=row['source']['duration'])
        cues = []
        for segment in text['segments']:
            content = segment['text'].strip()
            if not content:
                continue
            start = timedelta(seconds=segment['start'])
            stop = min(end, timedelta(seconds=segment['end']))
            if start >= stop:
                raise RuntimeError('caption_segment_outside_source')
            cues.append(srt.Subtitle(len(cues) + 1, start, stop, content))
        review.validate(cues, row['source']['duration'])
        actual = [{'start': c.start.total_seconds(), 'end': c.end.total_seconds(), 'text': c.content} for c in cues]
        review.save_new(folder / 'draft.json', json.dumps({'sourceSha256': row['source']['sha256'],
            'reviewStatus': 'draft_unreviewed', 'result': {'segments': actual}}, ensure_ascii=False).encode('utf8'))
        review.save_new(folder / 'draft.srt', srt.compose(cues).encode('utf8'))
        print(json.dumps({'key': key, 'draftCueCount': len(cues)}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('audit', 'mark-reviewed', 'upload', 'status', 'japanese', 'unlisted',
                                           'caption-draft', 'prepare-captions', 'approve-captions', 'serve-captions'))
    parser.add_argument('key', choices=tuple(FILES))
    parser.add_argument('--reviewed-source-sha')
    args = parser.parse_args()
    key, action = args.key, args.action
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, parents=False, exist_ok=True)
    if ROOT.resolve() != ROOT or ROOT.stat().st_mode & 0o077:
        raise RuntimeError('unsafe_private_state_root')
    module = load('upload-lesson-261024.py')
    module.ROOT, module.SOURCE, module.FILES, module.metadata = ROOT, SOURCE, FILES, metadata
    record_new_source = module.record_source

    def record_source(state, key):
        row = state['videos'].get(key)
        if row is None:
            return record_new_source(state, key)
        if row['snippet'] != metadata(key):
            raise RuntimeError('metadata_plan_changed')
        return checked_source(module, row, key), row

    module.record_source = record_source
    if action == 'caption-draft':
        caption_draft(module, key)
        return
    if action in ('prepare-captions', 'approve-captions'):
        review = load('review-lesson-261025-captions.py')
        review.ROOT, review.KEYS = ROOT, set(FILES)
        sys.argv = [sys.argv[0], action.split('-')[0], key]
        if args.reviewed_source_sha:
            sys.argv.extend(('--caption-sha', args.reviewed_source_sha))
        review.main(orthography=(('뒷꿈치', '뒤꿈치'), *ORTHOGRAPHY[key]))
        return
    if action == 'serve-captions':
        serve = load('serve-lesson-261024-captions.py')
        serve.lesson, serve.japanese = module, japanese
        sys.argv = [sys.argv[0], key]
        serve.main(expected_visibility='private')
        return
    with (ROOT / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state_file = ROOT / 'state.json'
        state = json.loads(state_file.read_text()) if state_file.exists() else {
            'version': 1, 'channelId': module.CHANNEL, 'date': '2026-11-21', 'videos': {}}
        if (state.get('date'), state.get('channelId')) != ('2026-11-21', module.CHANNEL):
            raise RuntimeError('wrong_lesson_ledger')
        _, row = module.record_source(state, key)
        file = checked_source(module, row, key)
        if action == 'audit':
            samples = ROOT / 'visual-qa'
            samples.mkdir(mode=0o700, exist_ok=True)
            for i, sec in enumerate((1, 90, row['source']['duration'] / 2, row['source']['duration'] - 5)):
                path = samples / f'{key}-{i}.jpg'
                if not path.exists():
                    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-n', '-ss', str(sec), '-i', str(file),
                                    '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=640:-2', str(path)], check=True)
            print(json.dumps({'key': key, 'source': row['source'], 'qaDirectory': str(samples)}))
        elif action == 'mark-reviewed':
            if (args.reviewed_source_sha != row['source']['sha256']
                    or not all((ROOT / 'visual-qa' / f'{key}-{i}.jpg').is_file() for i in range(4))):
                raise RuntimeError('source_review_binding_missing')
            row.update(visualReviewPassed=True, fullDecodePassed=True, nativeLessonId=FILES[key][-1],
                       reviewAt=datetime.now().astimezone().isoformat())
            module.save(state)
        elif action == 'upload':
            if row.get('fullDecodePassed') is not True or row.get('nativeLessonId') != FILES[key][-1]:
                raise RuntimeError('source_verification_incomplete')
            module.upload(state, key)
        elif action == 'unlisted':
            youtube, v = video_state(module, row)
            captions = youtube.captions().list(part='snippet', videoId=row['youtubeId']).execute()['items']
            if not any(t['snippet']['language'] == 'ko' and t['snippet']['status'] == 'serving' for t in captions):
                raise RuntimeError('korean_caption_not_serving')
            if v.get('localizations', {}).get('ja') != japanese(key):
                raise RuntimeError('japanese_metadata_not_verified')
            module.share_unlisted(state, key)
        else:
            youtube, v = video_state(module, row)
            if action == 'japanese' and v.get('localizations', {}).get('ja') != japanese(key):
                if v['status']['privacyStatus'] != 'private' or v['snippet']['defaultLanguage'] != 'ko':
                    raise RuntimeError('unexpected_localization_precondition')
                if row.get('japaneseIntentAt'):
                    raise RuntimeError('existing_localization_intent_reconcile_first')
                row['japaneseIntentAt'] = datetime.now().astimezone().isoformat()
                module.save(state)
                values = {**v.get('localizations', {}), 'ja': japanese(key)}
                youtube.videos().update(part='localizations', body={'id': row['youtubeId'], 'localizations': values}).execute()
                _, v = video_state(module, row)
                if v.get('localizations', {}) != values:
                    raise RuntimeError('localization_readback_failed')
            captions = youtube.captions().list(part='snippet', videoId=row['youtubeId']).execute()['items']
            print(json.dumps({'key': key, 'id': row['youtubeId'], 'privacy': v['status']['privacyStatus'],
                'upload': v['status'].get('uploadStatus'), 'processing': v.get('processingDetails', {}).get('processingStatus'),
                'japanese': v.get('localizations', {}).get('ja') == japanese(key), 'captions': [
                    {k: t['snippet'].get(k) for k in ('language', 'status', 'trackKind')} for t in captions]}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        message = str(exc) if isinstance(exc, RuntimeError) and str(exc).replace('_', '').isalnum() else ''
        print(json.dumps({'error': type(exc).__name__, 'detail': message,
                          'status': getattr(getattr(exc, 'resp', None), 'status', None)}))
        raise SystemExit(1) from None
