"""Serve approved Korean caption files, then add Japanese metadata; never public."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import time
from io import BytesIO

from googleapiclient.http import MediaIoBaseUpload

spec = importlib.util.spec_from_file_location('lesson_upload', Path(__file__).with_name('upload-lesson-261024.py'))
lesson = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lesson)


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def localization_readback_matches(expected, verified):
    actual = dict(verified.get('localizations', {}))
    # YouTube may materialize the default-language entry on the first translation.
    language = verified['snippet'].get('defaultLanguage')
    if language and language not in expected and actual.get(language) == {
            key: verified['snippet'][key] for key in ['title', 'description']}:
        actual.pop(language)
    return actual == expected


def japanese(key):
    _, team, _, instructor, _ = lesson.FILES[key]
    apparatus = 'バレル＋スティック' if 'minjin' in key else 'リフォーマー＋ブロック'
    name = 'ペ・ミンジン' if 'minjin' in key else 'チョン・ウニョン'
    return {'title': f'外部フィードバック2｜261024・{team}チーム・{name}・{apparatus}・受講者限定',
            'description': f'ARCHIVE PILATES · ARCHIVE METHOD\n2026年10月24日 {team}チームのインストラクターレッスン復習用動画です。\n\n'
            f'講師：{name}（{instructor}）\n器具・小道具：{apparatus}\nテーマ：外部フィードバック2\n\n'
            '当日の受講者向けの非売品コンテンツです。公式サイトに登録し、視聴権限が付与されたアカウントで「マイ教室」からご覧ください。\n'
            '視聴期間は、初回の権限付与が確認された時点から40日間です。\n\n'
            '公式サイト：https://archivepilates.com/\nマイ教室：https://archivepilates.imweb.me/48\n'
            'お問い合わせ：https://pf.kakao.com/_AHdvn/chat\n\n'
            'リンクの外部共有、保存、録画、複製、再配布は禁止です。限定公開動画はリンクを知っている人が視聴できるため、URLを外部に共有しないでください。\n\n'
            'ARCHIVE PILATES · 釜山・鳴旨'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('key', choices=list(lesson.FILES))
    args = parser.parse_args()
    root = lesson.ROOT
    with (root / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads((root / 'state.json').read_text())
        row = state['videos'][args.key]
        folder = root / 'captions' / args.key
        review_file, caption_file = folder / 'review.json', folder / 'corrected.srt'
        for file in [review_file, caption_file]:
            stat = file.lstat()
            if file.is_symlink() or not file.is_file() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
                raise RuntimeError('unsafe_caption_evidence')
        review = json.loads(review_file.read_text())
        if (review.get('allowedForServing') is not True or review.get('sourceSha256') != row['source']['sha256']
                or review.get('captionSha256') != sha(caption_file)):
            raise RuntimeError('caption_review_required')
        youtube, _, _ = lesson.clients()
        def read():
            items = youtube.videos().list(part='snippet,status,localizations', id=row['youtubeId']).execute()['items']
            if len(items) != 1 or items[0]['snippet']['channelId'] != lesson.CHANNEL:
                raise RuntimeError('caption_channel_mismatch')
            video = items[0]
            for key in ['title', 'description', 'categoryId', 'defaultLanguage', 'defaultAudioLanguage']:
                if video['snippet'].get(key) != row['snippet'].get(key):
                    raise RuntimeError('caption_original_metadata_changed')
            if sorted(video['snippet'].get('tags', [])) != sorted(row['snippet']['tags']):
                raise RuntimeError('caption_original_tags_changed')
            if video['status']['privacyStatus'] != 'unlisted':
                raise RuntimeError('student_visibility_changed')
            return video
        video = read()
        track_name = '한국어 · 강사레슨 자막'
        tracks = youtube.captions().list(part='snippet', videoId=row['youtubeId']).execute().get('items', [])
        matches = [track for track in tracks if track['snippet'].get('name') == track_name]
        if len(matches) > 1:
            raise RuntimeError('duplicate_caption_track_review_required')
        if not matches:
            if row.get('captionInsertIntentAt'):
                raise RuntimeError('prior_caption_insert_uncertain_no_retry')
            if sha(caption_file) != review['captionSha256']:
                raise RuntimeError('caption_changed_after_review')
            caption_bytes = caption_file.read_bytes()
            if hashlib.sha256(caption_bytes).hexdigest() != review['captionSha256']:
                raise RuntimeError('caption_changed_after_review')
            media = MediaIoBaseUpload(BytesIO(caption_bytes), mimetype='application/octet-stream')
            row.update(captionInsertIntentAt=time.time(), captionFileSha256=review['captionSha256'])
            lesson.save(state)
            track = youtube.captions().insert(part='snippet', body={'snippet': {
                'videoId': row['youtubeId'], 'language': 'ko', 'name': track_name, 'isDraft': False}},
                media_body=media).execute()
        else:
            track = matches[0]
            if row.get('captionFileSha256') != sha(caption_file):
                raise RuntimeError('existing_caption_hash_not_owned')
            if row.get('captionId') != track['id']:
                raise RuntimeError('existing_caption_identity_not_owned')
        row['captionId'] = track['id']
        lesson.save(state)
        for _ in range(20):
            track = youtube.captions().list(part='snippet', videoId=row['youtubeId'], id=row['captionId']).execute()['items'][0]
            if track['snippet'].get('status') == 'serving':
                break
            if track['snippet'].get('status') == 'failed':
                raise RuntimeError('caption_processing_failed')
            time.sleep(15)
        else:
            raise RuntimeError('caption_still_processing_resume_read_only_first')
        if track['snippet']['language'] != 'ko' or track['snippet'].get('isDraft'):
            raise RuntimeError('caption_language_or_draft_mismatch')
        row.update(captionReview=review['reviewScope'], captionStatus='serving', captionVerifiedAt=time.time())
        lesson.save(state)
        video = read()
        localizations = dict(video.get('localizations', {}))
        expected = japanese(args.key)
        if 'ja' in localizations and localizations['ja'] != expected:
            raise RuntimeError('existing_japanese_metadata_preserved_review_required')
        if localizations.get('ja') != expected:
            if row.get('japaneseIntentAt'):
                raise RuntimeError('japanese_result_unknown_no_automatic_retry')
            row['japaneseIntentAt'] = time.time()
            lesson.save(state)
            localizations['ja'] = expected
            youtube.videos().update(part='localizations', body={'id': row['youtubeId'], 'localizations': localizations}).execute()
        for attempt in range(5):
            verified = read()
            if localization_readback_matches(localizations, verified):
                break
            if attempt < 4:
                time.sleep(2)
        else:
            raise RuntimeError('localized_metadata_readback_failed')
        row['japaneseVerifiedAt'] = time.time()
        lesson.save(state)
        print(json.dumps({'key': args.key, 'koreanCaption': 'serving', 'japaneseMetadata': 'verified',
                          'originalKoreanMetadataPreserved': True, 'visibility': 'unlisted',
                          'reviewScope': review['reviewScope']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'errorType': type(error).__name__,
                          'code': str(error) if type(error) is RuntimeError and str(error) in {
                              'unsafe_caption_evidence', 'caption_review_required', 'caption_channel_mismatch',
                              'caption_original_metadata_changed', 'caption_original_tags_changed', 'student_visibility_changed',
                              'duplicate_caption_track_review_required', 'prior_caption_insert_uncertain_no_retry',
                              'caption_changed_after_review', 'existing_caption_hash_not_owned', 'existing_caption_identity_not_owned',
                              'caption_processing_failed', 'caption_still_processing_resume_read_only_first',
                              'caption_language_or_draft_mismatch', 'existing_japanese_metadata_preserved_review_required',
                              'japanese_result_unknown_no_automatic_retry', 'localized_metadata_readback_failed',
                          } else 'caption_operation_failed_without_credentials'}), flush=True)
        raise SystemExit(1)
