"""Prepare local Korean caption drafts; never uploads or approves a draft."""
from datetime import timedelta
import json
import os
from pathlib import Path
import subprocess

import mlx_whisper
import srt

ROOT = Path.home() / 'Library/Application Support/ARCHIVE PILATES/lesson-videos-261024'
MODEL = Path.home() / '.cache/huggingface/hub/models--mlx-community--whisper-large-v3-mlx/snapshots/49e6aa286ad60c14352c404340ded53710378a11'


def main():
    os.umask(0o077)
    state = json.loads((ROOT / 'state.json').read_text())
    for key, row in state['videos'].items():
        output = ROOT / 'captions' / key
        output.mkdir(parents=True, exist_ok=True, mode=0o700)
        result_file = output / 'draft.json'
        if result_file.exists():
            print(json.dumps({'key': key, 'draftAlreadyPrepared': True}), flush=True)
            continue
        audio = output / 'source.wav'
        if not audio.exists():
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', row['source']['path'],
                            '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(audio)], check=True)
        print(json.dumps({'key': key, 'localTranscription': 'started'}), flush=True)
        result = mlx_whisper.transcribe(str(audio), path_or_hf_repo=str(MODEL), language='ko',
            task='transcribe', verbose=None, condition_on_previous_text=False,
            initial_prompt='필라테스 강사레슨. 아카이브 메소드, 바렐, 스틱, 리포머, 블럭, 캐리지, 풋바, 골반, 흉곽, 견갑골, 외부 피드백, 큐잉.')
        result_file.write_text(json.dumps({'sourceSha256': row['source']['sha256'],
            'reviewStatus': 'draft_unreviewed', 'result': result}, ensure_ascii=False), encoding='utf8')
        subtitles = [srt.Subtitle(index=n + 1, start=timedelta(seconds=segment['start']),
            end=timedelta(seconds=segment['end']), content=segment['text'].strip())
            for n, segment in enumerate(result['segments']) if segment['text'].strip()]
        (output / 'draft.srt').write_text(srt.compose(subtitles), encoding='utf8')
        print(json.dumps({'key': key, 'captionDraftCues': len(subtitles), 'reviewRequired': True}), flush=True)


if __name__ == '__main__':
    main()
