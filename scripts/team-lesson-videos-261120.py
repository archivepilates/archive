"""Exact November 20 team lesson batch; private upload then unlisted only."""
import argparse
from datetime import timedelta
from datetime import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

BASE = Path('/Users/archivepilates/dev/archive-in-runtime/scripts')
ROOT = Path('/Users/archivepilates/archive-automation/operations/team-lesson-videos-261120')
VOLUME = Path('/Volumes/아카아브 2T')
SOURCE = VOLUME / '아카이브 메소드/팀강사레슨 1120'
MEDIA = VOLUME / 'ARCHIVE PILATES/lesson-qa/2026-11-20'
FILES = {
    'minjin-chair': ('민진 체어.m4v', 'Team', '민진', '배민진', '체어'),
    'minjin-chair-reexport': ('민진 체어 재내보내기 261120.m4v', 'Team', '민진', '배민진', '체어'),
    'eunyeong-barrel': ('은영 바렐.m4v', 'Team', '은영', '정은영', '바렐'),
}


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), BASE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def metadata(key):
    _, team, short, name, equipment = FILES[key]
    suffix = ' · 검증본' if key == 'minjin-chair-reexport' else ''
    return {'title': f'ARCHIVE METHOD #1 직장인 증후군 | 261120 · Team 강사레슨 · {short} · {equipment} · 수강생 공유{suffix}',
        'description': f'ARCHIVE PILATES · ARCHIVE METHOD\n2026년 11월 20일 Team 강사레슨 복습 영상입니다.\n\n강사: {name}\n기구: {equipment}\n주제: ARCHIVE METHOD #1 직장인 증후군\n\n'
        '해당 회차 등록 수강생을 위한 비판매 콘텐츠입니다. 홈페이지 가입 후 시청 권한이 연결된 계정으로 로그인해 내 강의실에서 확인해 주세요.\n'
        '시청 기간은 최초 권한 부여가 확인된 시점부터 40일입니다.\n\n홈페이지: https://archivepilates.com/\n내 강의실: https://archivepilates.imweb.me/48\n권한 문의: https://pf.kakao.com/_AHdvn/chat\n\n'
        '외부 링크 공유, 저장, 녹화, 복제 및 재배포를 금지합니다. 일부공개 영상은 링크를 가진 사람이 볼 수 있으므로 영상 주소를 외부에 전달하지 마세요.\n\nARCHIVE PILATES · 부산 명지',
        'tags': ['ARCHIVE PILATES', 'ARCHIVE METHOD', '필라테스 강사레슨', 'Team 강사레슨', '직장인 증후군', '수강생 복습', name, equipment],
        'categoryId': '27', 'defaultLanguage': 'ko', 'defaultAudioLanguage': 'ko'}


def japanese(key):
    minjin = key.startswith('minjin-chair')
    name, equipment = ('ペ・ミンジン', 'チェア') if minjin else ('チョン・ウニョン', 'バレル')
    return {'title': f'ARCHIVE METHOD #1 デスクワークによる不調 | 261120・Team指導者レッスン・{name}・{equipment}・受講者限定',
        'description': f'ARCHIVE PILATES · ARCHIVE METHOD\n2026年11月20日のTeam指導者レッスン復習用動画です。\n講師：{name}\n器具：{equipment}\nテーマ：ARCHIVE METHOD #1 デスクワークによる不調\n\n'
        '当該回の登録受講者向け非売品コンテンツです。公式サイトに登録し、視聴権限が付与されたアカウントで「マイ教室」からご覧ください。視聴期間は初回の権限付与が確認された時点から40日間です。\n\n'
        '公式サイト：https://archivepilates.com/\nマイ教室：https://archivepilates.imweb.me/48\nお問い合わせ：https://pf.kakao.com/_AHdvn/chat\n\n'
        'リンクの外部共有、保存、録画、複製、再配布は禁止です。限定公開動画はリンクを知っている人が視聴できるため、URLを外部に共有しないでください。'}


def configured():
    m = load('upload-lesson-261024.py')
    m.ROOT, m.SOURCE, m.FILES, m.metadata = ROOT, SOURCE, FILES, metadata
    original_record = m.record_source

    def record_verified(state, key):
        row = state.get('videos', {}).get(key)
        if row is None:
            return original_record(state, key)
        file = m.source_file(FILES[key][0])
        stat = file.stat()
        assert str(file) == row['source']['path']
        assert stat.st_size == row['source']['size'] and stat.st_mtime_ns == row['source']['mtimeNs']
        assert row['snippet'] == metadata(key)
        return file, row

    m.record_source = record_verified
    return m


def inspect(key):
    import cv2
    from PIL import Image, ImageDraw
    m = configured()
    state = json.loads((ROOT / 'state.json').read_text())
    row = state['videos'][key]
    file = Path(row['source']['path'])
    folder = MEDIA / key
    folder.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(file))
    sheet = Image.new('RGB', (1280, 800), 'white')
    try:
        for i, sec in enumerate([1, 60, row['source']['duration']/2, row['source']['duration']-3]):
            cap.set(cv2.CAP_PROP_POS_MSEC, sec*1000)
            ok, frame = cap.read()
            assert ok and frame.std() > 10
            image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            sheet.paste(image.resize((640, 360)), ((i%2)*640, (i//2)*400))
            ImageDraw.Draw(sheet).text(((i%2)*640+10, (i//2)*400+365), f'{sec:.2f}s', fill='black')
    finally:
        cap.release()
    sheet.save(folder / 'contact.jpg')
    print(json.dumps({'key': key, 'contact': str(folder / 'contact.jpg')}), flush=True)
    result = subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-v', 'error', '-xerror', '-threads', '4',
        '-progress', str(folder / 'decode-progress.txt'),
        '-i', str(file), '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], capture_output=True, text=True)
    (folder / 'decode-stderr.txt').write_text(result.stderr)
    if result.returncode:
        (folder / 'decode.json').write_text(json.dumps({'fullDecode':'failed','exitCode':result.returncode,
            'sha256':row['source']['sha256'],'progressFile':str(folder/'decode-progress.txt')}))
        raise RuntimeError('Source decode failed; inspect the preserved progress and decoder diagnostics')
    assert file.stat().st_size == row['source']['size'] and file.stat().st_mtime_ns == row['source']['mtimeNs']
    (folder / 'decode.json').write_text(json.dumps({'fullDecode': 'passed', 'sha256': row['source']['sha256'],
        'duration': row['source']['duration'], 'sourceUnchanged': True}))
    print(json.dumps({'key': key, 'fullDecode': 'passed'}), flush=True)


def transcribe(key):
    import mlx_whisper
    import srt
    state = json.loads((ROOT / 'state.json').read_text())
    row = state['videos'][key]
    folder = ROOT / 'captions' / key
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    if (folder / 'draft.json').exists():
        print('Caption draft already exists; review it instead of retranscribing')
        return
    audio = MEDIA / key / 'source.wav'
    if not audio.exists():
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-n', '-i', row['source']['path'], '-vn',
            '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(audio)], check=True)
    probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries',
        'format=duration:stream=sample_rate,channels','-of','json',str(audio)]))
    assert abs(float(probe['format']['duration'])-row['source']['duration']) < .2
    assert probe['streams'][0]['sample_rate'] == '16000' and probe['streams'][0]['channels'] == 1
    model = VOLUME / 'ARCHIVE PILATES/models/huggingface/hub/models--mlx-community--whisper-large-v3-mlx/snapshots/49e6aa286ad60c14352c404340ded53710378a11'
    result = mlx_whisper.transcribe(str(audio), path_or_hf_repo=str(model), language='ko', verbose=False,
        condition_on_previous_text=False, initial_prompt='아카이브 메소드 팀 강사레슨, 직장인 증후군, 체어, 바렐, 골반, 흉곽, 견갑골, 큐잉, 배민진, 정은영.')
    (folder / 'draft.json').write_text(json.dumps({'sourceSha256': row['source']['sha256'],
        'reviewStatus': 'draft_unreviewed', 'result': result}, ensure_ascii=False))
    cues = [srt.Subtitle(index=i+1,start=timedelta(seconds=s['start']),end=timedelta(seconds=s['end']),content=s['text'].strip())
        for i,s in enumerate(result['segments']) if s['text'].strip()]
    (folder / 'draft.srt').write_text(srt.compose(cues))
    print(json.dumps({'key': key, 'draftCueCount': len(cues)}), flush=True)


def prepare_captions(key):
    import srt
    review = load('review-lesson-261025-captions.py')
    row = json.loads((ROOT / 'state.json').read_text())['videos'][key]
    folder = ROOT / 'captions' / key
    raw = review.private_read(folder / 'draft.srt')
    draft = json.loads(review.private_read(folder / 'draft.json'))
    assert draft['sourceSha256'] == row['source']['sha256']
    cues = list(srt.parse(raw.decode('utf8')))
    review.assert_agreement(cues, [s for s in draft['result']['segments'] if s['text'].strip()])
    changes = []
    for cue in cues:
        if cue.end.total_seconds() > row['source']['duration']:
            assert cue is cues[-1] and cue.end.total_seconds() <= row['source']['duration'] + .05
            changes.append({'cue': cue.index, 'beforeEnd': cue.end.total_seconds(), 'end': row['source']['duration'],
                'reason': 'Final model timestamp rounding, bounded by actual media end'})
            cue.end = timedelta(seconds=row['source']['duration'])
    corrections = sum(c.content.count('뒷꿈치') for c in cues)
    for cue in cues:
        cue.content = cue.content.replace('뒷꿈치', '뒤꿈치')
    review.validate(cues, row['source']['duration'])
    result = srt.compose(cues).encode('utf8')
    data = {'allowedForServing': False, 'sourceSha256': row['source']['sha256'],
        'captionSha256': review.digest(result), 'draftSha256': review.digest(raw), 'reviewScope': review.SCOPE,
        'cueCount': len(cues), 'orthographicCorrections': corrections, 'semanticChanges': 0,
        'timestampChanges': len(changes), 'timestampNormalization': changes, 'manualFullAudioAudit': False}
    review.save_identical_or_new(folder / 'corrected.srt', result)
    review.save_identical_or_new(folder / 'review.json', json.dumps(data, ensure_ascii=False, indent=2).encode('utf8'))
    print(json.dumps({'key': key, **data}, ensure_ascii=False))


def audio_qa(key):
    import numpy as np
    import wave
    file = MEDIA / key / 'source.wav'
    with wave.open(str(file)) as stream:
        assert stream.getnchannels() == 1 and stream.getsampwidth() == 2 and stream.getframerate() == 16000
        samples = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float64) / 32768
    state = json.loads((ROOT / 'state.json').read_text())
    source = state['videos'][key]['source']
    assert abs(len(samples)/16000 - source['duration']) < .2
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples * samples)))
    blocks = samples[:len(samples)//16000*16000].reshape(-1, 16000)
    quiet = np.sqrt(np.mean(blocks*blocks, axis=1)) < .001
    runs, start = [], None
    for i, value in enumerate([*quiet, False]):
        if value and start is None:
            start = i
        elif not value and start is not None:
            if i-start >= 5:
                runs.append({'start':start,'end':i,'seconds':i-start})
            start = None
    result = {'sourceSha256':source['sha256'],'peakDbfs':20*float(np.log10(max(peak,1e-12))),
        'rmsDbfs':20*float(np.log10(max(rms,1e-12))),
        'nearFullScaleFraction':float(np.mean(np.abs(samples)>=.999)),
        'quietRunsAtLeastFiveSeconds':runs,'analysis':'Decoded mono speech analysis; quiet passages are not automatically missing audio.'}
    (MEDIA / key / 'audio-qa.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'key':key,**result}))


def reuse_verified_audio_draft(key):
    assert key == 'minjin-chair-reexport'
    m = configured()
    with (ROOT / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads((ROOT / 'state.json').read_text())
        old, new = state['videos']['minjin-chair'], state['videos'][key]
        proof = json.loads((MEDIA / key / 'decode.json').read_text())
        assert proof['fullDecode'] == 'passed' and proof['sha256'] == new['source']['sha256']
        assert abs(new['source']['duration'] - old['source']['duration']) < .001
        folder = MEDIA / key
        audio = folder / 'source.wav'
        if not audio.exists():
            subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',new['source']['path'],
                '-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',str(audio)],check=True)
        previous_audio = MEDIA / 'minjin-chair/source.wav'
        assert m.digest(audio) == m.digest(previous_audio), 'Re-export audio differs; transcribe the new source separately'
        previous = ROOT / 'captions/minjin-chair'
        target = ROOT / 'captions' / key
        target.mkdir(parents=True,exist_ok=True,mode=0o700)
        review = load('review-lesson-261025-captions.py')
        draft = json.loads(review.private_read(previous / 'draft.json'))
        assert draft['sourceSha256'] == old['source']['sha256']
        draft.update(sourceSha256=new['source']['sha256'], reusedFromSourceSha256=old['source']['sha256'],
            reuseProof='Identical decoded 16 kHz mono WAV SHA256 and identical source duration')
        review.save_identical_or_new(target/'draft.json',json.dumps(draft,ensure_ascii=False).encode())
        for name in ['draft.srt','corrected.srt']:
            review.save_identical_or_new(target/name,review.private_read(previous/name))
        record = json.loads(review.private_read(previous/'review.json'))
        assert record['allowedForServing'] is False
        record.update(sourceSha256=new['source']['sha256'],audioIdentitySha256=m.digest(audio),
            reusedFromSourceSha256=old['source']['sha256'])
        review.save_identical_or_new(target/'review.json',json.dumps(record,ensure_ascii=False,indent=2).encode())
        print(json.dumps({'key':key,'audioIdentityVerified':True,'captionDraftReused':True,'allowedForServing':False}))


def source_failure(key):
    assert key == 'minjin-chair'
    m = configured()
    with (ROOT / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads((ROOT / 'state.json').read_text())
        row = state['videos'][key]
        youtube, _, _ = m.clients()
        current = youtube.videos().list(part='status', id=row['youtubeId']).execute()['items'][0]
        assert current['status']['privacyStatus'] == 'private'
        row.update(state='source_decode_failed_private_hold', visibility='private', qualityHold={
            'code': 'FFMPEG_H264_CORRUPT_FRAME', 'sourceSha256': row['source']['sha256'],
            'observedAt': datetime.now().astimezone().isoformat(),
            'evidence': 'Both VideoToolbox and software H.264 decoders reported errors; software xerror exited183',
            'nextAction': 'Locate the affected section; preserve the original and obtain a verified replacement export.'})
        m.save(state)
        if not row.get('sourceFailureNotice'):
            event = hashlib.sha256(('team-261120/source-decode/'+row['source']['sha256']).encode()).hexdigest()
            row['sourceFailureNoticeIntent'] = event
            m.save(state)
            env = {**os.environ, 'AUTOMATION_REPORT_FROM':'home@archivepilates.com',
                'AUTOMATION_REPORT_TO':'home@archivepilates.com', 'AUTOMATION_REPORT_EVENT_ID':event,
                'AUTOMATION_REPORT_LABEL':'자동화 실패',
                'AUTOMATION_REPORT_SUBJECT':'[강사레슨영상][실패] 11/20 민진 체어 원본 검증 중단',
                'AUTOMATION_REPORT_BODY':'주체: ARCHIVE PILATES / 강사레슨 영상 공유\n결론: 11/20 민진 체어 원본에서 하드웨어·소프트웨어 H.264 디코딩 오류가 재현돼 수강생 공유를 보류했습니다.\n현재: YouTube 비공개 업로드만 완료했고 일부공개·홈페이지 권한 부여·회원 안내는 실행하지 않았습니다. 은영 바렐 내보내기 완료 후 검증·업로드는 별도로 이어갑니다.\n조치: 원본 해시와 파일을 보존하고 오류 구간을 추가 확인 중입니다.\n다음: 민진 체어는 기존 파일을 덮어쓰지 않은 새 내보내기 파일이 필요할 수 있습니다. 홈페이지 연결에는 아임웹 관리자 로그인도 필요합니다.\n회원 연락처·주문·결제·기존 권한은 변경하지 않았습니다.'}
            result = subprocess.run(['node', str(BASE.parent/'firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs')],
                env=env, capture_output=True, text=True, timeout=60, check=True)
            receipt = json.loads(result.stdout)
            assert receipt.get('messageId')
            row['sourceFailureNotice'] = receipt
            m.save(state)
        print(json.dumps({'key':key,'state':row['state'],'noticeMessageId':row['sourceFailureNotice']['messageId']}))


def download_native_asr(key):
    m = configured()
    state = json.loads((ROOT / 'state.json').read_text())
    row = state['videos'][key]
    youtube, _, _ = m.clients()
    video = youtube.videos().list(part='snippet', id=row['youtubeId']).execute()['items']
    assert len(video) == 1 and video[0]['snippet']['channelId'] == m.CHANNEL
    tracks = youtube.captions().list(part='snippet', videoId=row['youtubeId']).execute().get('items', [])
    matches = [track for track in tracks if track['snippet'].get('language') == 'ko'
        and track['snippet'].get('trackKind') == 'asr' and track['snippet'].get('status') == 'serving']
    if not matches:
        print(json.dumps({'key':key,'nativeAsrSaved':False,'status':'pending_not_yet_available'}))
        return
    assert len(matches) == 1
    data = youtube.captions().download(id=matches[0]['id'], tfmt='srt').execute()
    folder = ROOT / 'captions' / key
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    review = load('review-lesson-261025-captions.py')
    review.save_identical_or_new(folder / 'youtube-asr.srt', data)
    print(json.dumps({'key':key,'nativeAsrSaved':True,'bytes':len(data)}))


def recheck_minjin_terms(key):
    assert key == 'minjin-chair'
    import mlx_whisper
    import numpy as np
    import wave
    audio = MEDIA / key / 'source.wav'
    with wave.open(str(audio)) as stream:
        assert stream.getframerate() == 16000 and stream.getnchannels() == 1
        samples = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float32) / 32768
    folder = ROOT / 'captions' / key / 'term-rechecks'
    folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    model = VOLUME / 'ARCHIVE PILATES/models/huggingface/hub/models--mlx-community--whisper-large-v3-mlx/snapshots/49e6aa286ad60c14352c404340ded53710378a11'
    windows = [(435,445),(482,491),(605,616),(1725,1735),(2068,2078),(2316,2327),(2553,2563),(2783,2799),(3048,3056)]
    for start,end in windows:
        file = folder / f'{start}-{end}.json'
        if file.exists():
            continue
        result = mlx_whisper.transcribe(samples[start*16000:end*16000],path_or_hf_repo=str(model),
            language='ko',temperature=0,verbose=False,condition_on_previous_text=False,
            initial_prompt='한국어 필라테스 강사레슨 원음. 발화를 있는 그대로 전사.')
        load('review-lesson-261025-captions.py').save_new(file,json.dumps({
            'start':start,'end':end,'sourceAudioSha256':configured().digest(audio),
            'scope':'Second bounded model transcription, not human listening or definitive source proof',
            'result':result},ensure_ascii=False).encode())
        print(json.dumps({'start':start,'end':end,'text':result['text']},ensure_ascii=False),flush=True)


def homepage_blocker():
    m = configured()
    with (ROOT/'run.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        state=json.loads((ROOT/'state.json').read_text())
        current=state.setdefault('websiteSharing',{})
        current.update(status='blocked_auth_rate_limit',source='direct_operator_report',
            observedAt=datetime.now().astimezone().isoformat(),
            nativePagesPublished=False,memberPermissionsChanged=False,memberNoticesSent=False,
            nextAction='Resume the same batch only after native administrator login restriction is cleared; no password retry loop.')
        m.save(state)
        if not current.get('blockerNotice'):
            event=hashlib.sha256(b'team-261120/homepage-auth-rate-limit').hexdigest()
            current['blockerNoticeIntent']=event
            m.save(state)
            summary='\n'.join(f"{key}: {row['state']}" for key,row in state['videos'].items())
            env={**os.environ,'AUTOMATION_REPORT_FROM':'home@archivepilates.com','AUTOMATION_REPORT_TO':'home@archivepilates.com',
                'AUTOMATION_REPORT_EVENT_ID':event,'AUTOMATION_REPORT_LABEL':'자동화 확인필요',
                'AUTOMATION_REPORT_SUBJECT':'[강사레슨영상][확인필요] 11/20 홈페이지 공유 로그인 제한',
                'AUTOMATION_REPORT_BODY':'주체: ARCHIVE PILATES / 강사레슨 영상 공유\n'
                    '11/20 Team 강사레슨의 홈페이지 공유가 관리자 로그인 횟수 제한으로 대기 중입니다. 운영자가 제한을 직접 확인해 추가 로그인 시도를 중단했습니다.\n'
                    '현재 영상 원장:\n'+summary+'\n'
                    '영상·자막 검사는 별도로 진행하며 기존 파일·구매 권한·회원 등급·시청기간은 보존했습니다. 수강생 권한 부여와 안내 발송은 아직 실행하지 않았습니다.\n'
                    '다음 조치: 로그인 제한 해제 후 동일 원장으로 보호 페이지·내 강의실 연결·40일 권한 부여와 실제 시청 검증을 이어갑니다. 비밀번호 재시도 자동화는 추가하지 않았습니다.'}
            result=subprocess.run(['node',str(BASE.parent/'firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs')],
                env=env,capture_output=True,text=True,timeout=60,check=True)
            current['blockerNotice']=json.loads(result.stdout)
            assert current['blockerNotice'].get('messageId')
            m.save(state)
        print(json.dumps({'websiteSharing':current['status'],'noticeMessageId':current['blockerNotice']['messageId']}))


def record_private_checks(key):
    m=configured()
    with (ROOT/'run.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        state=json.loads((ROOT/'state.json').read_text())
        row=state['videos'][key]
        youtube,_,_=m.clients()
        video=youtube.videos().list(part='snippet,status,processingDetails',id=row['youtubeId']).execute()['items']
        assert len(video)==1 and video[0]['snippet']['channelId']==m.CHANNEL
        current=video[0]
        for field,value in row['snippet'].items():
            actual=current['snippet'].get(field)
            assert (sorted(actual)==sorted(value) if field=='tags' else actual==value)
        assert current['status']['privacyStatus']=='private'
        proof=json.loads((MEDIA/key/'decode.json').read_text())
        assert proof['fullDecode']=='passed' and proof['sha256']==row['source']['sha256']
        row['privateVerification']={'verifiedAt':datetime.now().astimezone().isoformat(),
            'processing':current.get('processingDetails',{}).get('processingStatus'),
            'uploadStatus':current['status']['uploadStatus'],'visibility':'private',
            'fullDecode':'passed','sourceSha256':row['source']['sha256']}
        review_file=ROOT/'captions'/key/'review.json'
        if review_file.exists():
            review=json.loads(review_file.read_text())
            assert review['sourceSha256']==row['source']['sha256']
            assert review['captionSha256']==m.digest(review_file.with_name('corrected.srt'))
            row['captionReview']='pending_source_term_review' if not review['allowedForServing'] else review['reviewScope']
        row['visibility']='private'
        m.save(state)
        print(json.dumps({'key':key,**row['privateVerification'],'captionReview':row.get('captionReview','pending')}))


def record_unlisted_checks(key):
    assert key in {'minjin-chair-reexport', 'eunyeong-barrel'}
    m = configured()
    with (ROOT / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads((ROOT / 'state.json').read_text())
        row = state['videos'][key]
        youtube, _, _ = m.clients()
        items = youtube.videos().list(part='snippet,status,processingDetails,localizations', id=row['youtubeId']).execute()['items']
        assert len(items) == 1 and items[0]['snippet']['channelId'] == m.CHANNEL
        video = items[0]
        assert video['status']['privacyStatus'] == 'unlisted' and video['status']['uploadStatus'] == 'processed'
        assert video['processingDetails']['processingStatus'] == 'succeeded'
        for field, value in row['snippet'].items():
            actual = video['snippet'].get(field)
            assert sorted(actual) == sorted(value) if field == 'tags' else actual == value
        assert video.get('localizations', {}).get('ja') == japanese(key)
        tracks = youtube.captions().list(part='snippet', videoId=row['youtubeId']).execute()['items']
        assert any(track['id'] == row['captionId'] and track['snippet']['language'] == 'ko'
                   and track['snippet']['status'] == 'serving' for track in tracks)
        decode = json.loads((MEDIA / key / 'decode.json').read_text())
        assert decode['fullDecode'] == 'passed' and decode['sha256'] == row['source']['sha256']
        row['visibility'] = 'unlisted'
        row['deliveryVideoVerification'] = {'verifiedAt': datetime.now().astimezone().isoformat(),
            'processing': 'succeeded', 'privacyStatus': 'unlisted', 'koreanCaption': 'serving',
            'japaneseMetadata': 'verified', 'originalKoreanMetadataPreserved': True,
            'sourceSha256': row['source']['sha256'], 'fullDecode': 'passed'}
        m.save(state)
        print(json.dumps({'key': key, 'youtubeId': row['youtubeId'], **row['deliveryVideoVerification']}))


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['audit','inspect','approve-visual','upload-private','share-unlisted','transcribe',
        'prepare-captions','approve-captions','serve-captions','source-failure','download-native-asr','audio-qa',
        'reuse-verified-audio-draft','recheck-minjin-terms','homepage-blocker','record-private-checks','record-unlisted-checks'])
    parser.add_argument('key', choices=list(FILES))
    parser.add_argument('--caption-sha')
    args = parser.parse_args()
    if args.action == 'inspect':
        inspect(args.key)
    elif args.action == 'transcribe':
        transcribe(args.key)
    elif args.action == 'prepare-captions':
        prepare_captions(args.key)
    elif args.action == 'audio-qa':
        audio_qa(args.key)
    elif args.action == 'reuse-verified-audio-draft':
        reuse_verified_audio_draft(args.key)
    elif args.action == 'approve-captions':
        m = load('review-lesson-261025-captions.py')
        m.ROOT, m.KEYS = ROOT, set(FILES)
        sys.argv = [sys.argv[0], args.action.split('-')[0], args.key]
        if args.caption_sha:
            sys.argv += ['--caption-sha', args.caption_sha]
        m.main()
    elif args.action == 'serve-captions':
        m = load('serve-lesson-261024-captions.py')
        m.lesson, m.japanese = configured(), japanese
        sys.argv = [sys.argv[0], args.key]
        m.main()
    elif args.action == 'source-failure':
        source_failure(args.key)
    elif args.action == 'download-native-asr':
        download_native_asr(args.key)
    elif args.action == 'recheck-minjin-terms':
        recheck_minjin_terms(args.key)
    elif args.action == 'homepage-blocker':
        homepage_blocker()
    elif args.action == 'record-private-checks':
        record_private_checks(args.key)
    elif args.action == 'record-unlisted-checks':
        record_unlisted_checks(args.key)
    else:
        m = configured()
        if args.action == 'share-unlisted':
            proof = json.loads((MEDIA / args.key / 'decode.json').read_text())
            row = json.loads((ROOT / 'state.json').read_text())['videos'][args.key]
            assert proof['fullDecode'] == 'passed' and proof['sha256'] == row['source']['sha256']
            assert row.get('qualityHold') is None
        sys.argv = [sys.argv[0], args.action, args.key]
        m.main()
