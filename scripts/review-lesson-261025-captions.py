"""Validate local C/D caption drafts; serving approval is a separate explicit step."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path

import srt

ROOT = Path.home() / 'Library/Application Support/ARCHIVE PILATES/lesson-videos-261025'
KEYS = {'c-minjin', 'd-minjin', 'c-eunyeong', 'd-eunyeong'}
SCOPE = 'model-assisted orthography and complete timestamp validation; not a full manual audio audit'


def digest(value):
    return hashlib.sha256(value).hexdigest()


def private_read(file):
    stat = file.lstat()
    if file.is_symlink() or not file.is_file() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise RuntimeError('unsafe_caption_evidence')
    return file.read_bytes()


def validate(cues, duration):
    if not cues or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise RuntimeError('empty_caption_or_invalid_duration')
    previous = 0.0
    for index, cue in enumerate(cues, 1):
        start, end = cue.start.total_seconds(), cue.end.total_seconds()
        if cue.index != index or not cue.content.strip() or start < previous or end <= start or end > duration + .001:
            raise RuntimeError('invalid_caption_sequence_or_bounds')
        previous = end


def save_new(file, value):
    with file.open('xb') as output:
        os.chmod(file, 0o600)
        output.write(value)
        output.flush()
        os.fsync(output.fileno())


def save_identical_or_new(file, value):
    if file.exists() or file.is_symlink():
        if private_read(file) != value:
            raise RuntimeError('existing_caption_evidence_conflicts')
    else:
        save_new(file, value)


def assert_agreement(cues, segments):
    if len(cues) != len(segments):
        raise RuntimeError('draft_json_srt_disagreement')
    for cue, segment in zip(cues, segments):
        times = [segment['start'], segment['end']]
        if any(isinstance(value, bool) or not isinstance(value, (int, float))
               or not math.isfinite(value) for value in times):
            raise RuntimeError('invalid_json_caption_timestamp')
        if (cue.content != segment['text'].strip()
                or abs(cue.start.total_seconds() - times[0]) > .001
                or abs(cue.end.total_seconds() - times[1]) > .001):
            raise RuntimeError('draft_json_srt_disagreement')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'approve'])
    parser.add_argument('key', choices=sorted(KEYS))
    parser.add_argument('--caption-sha')
    args = parser.parse_args()
    os.umask(0o077)
    row = json.loads(private_read(ROOT / 'state.json'))['videos'][args.key]
    folder = ROOT / 'captions' / args.key
    review_file, corrected_file = folder / 'review.json', folder / 'corrected.srt'
    if args.action == 'prepare':
        if args.caption_sha:
            raise RuntimeError('prepare_has_no_approval_hash')
        draft_bytes = private_read(folder / 'draft.srt')
        draft = json.loads(private_read(folder / 'draft.json'))
        if draft['sourceSha256'] != row['source']['sha256'] or draft.get('reviewStatus') != 'draft_unreviewed':
            raise RuntimeError('wrong_caption_source')
        cues = list(srt.parse(draft_bytes.decode('utf8')))
        validate(cues, row['source']['duration'])
        segments = [item for item in draft['result']['segments'] if item['text'].strip()]
        assert_agreement(cues, segments)
        corrections = sum(cue.content.count('뒷꿈치') for cue in cues)
        for cue in cues:
            cue.content = cue.content.replace('뒷꿈치', '뒤꿈치')
        result = srt.compose(cues).encode('utf8')
        validate(list(srt.parse(result.decode('utf8'))), row['source']['duration'])
        review = {'allowedForServing': False, 'sourceSha256': row['source']['sha256'],
                  'captionSha256': digest(result), 'draftSha256': digest(draft_bytes), 'reviewScope': SCOPE,
                  'cueCount': len(cues), 'orthographicCorrections': corrections,
                  'semanticChanges': 0, 'timestampChanges': 0,
                  'shortCuesUnder300ms': sum((cue.end - cue.start).total_seconds() < .3 for cue in cues),
                  'longCuesOver12s': sum((cue.end - cue.start).total_seconds() > 12 for cue in cues),
                  'manualFullAudioAudit': False}
        save_identical_or_new(corrected_file, result)
        if review_file.exists() or review_file.is_symlink():
            existing = json.loads(private_read(review_file))
            if type(existing.get('allowedForServing')) is not bool or {**existing, 'allowedForServing': False} != review:
                raise RuntimeError('existing_caption_review_conflicts')
            review = existing
        else:
            save_new(review_file, json.dumps(review, ensure_ascii=False, indent=2).encode('utf8'))
    else:
        review = json.loads(private_read(review_file))
        result = private_read(corrected_file)
        if (not args.caption_sha or args.caption_sha != digest(result) or args.caption_sha != review['captionSha256']
                or review['sourceSha256'] != row['source']['sha256'] or review['reviewScope'] != SCOPE
                or review['draftSha256'] != digest(private_read(folder / 'draft.srt'))):
            raise RuntimeError('approval_hash_or_source_changed')
        validate(list(srt.parse(result.decode('utf8'))), row['source']['duration'])
        if review['allowedForServing'] is not True:
            review['allowedForServing'] = True
            temporary = review_file.with_suffix('.json.tmp')
            save_identical_or_new(temporary, json.dumps(review, ensure_ascii=False, indent=2).encode('utf8'))
            temporary.replace(review_file)
    print(json.dumps({'key': args.key, **review}, ensure_ascii=False))


if __name__ == '__main__':
    main()
