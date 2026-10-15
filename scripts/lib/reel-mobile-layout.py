"""Deterministic reel graphics inside a conservative mobile Shorts safe area."""
from datetime import timedelta
import json
from pathlib import Path
import subprocess

WIDTH, HEIGHT = 1080, 1920
SAFE = (144, 200, 800, 1430)
VIDEO = (120, 520, 752, 660)
CAPTION = (132, 1230, 680, 190)
FONT = Path.home() / 'Library/Fonts/Paperlogy-7Bold.ttf'
BACKGROUND = '#faf9f7'


def within_safe(box):
    x, y, right, bottom = box
    return SAFE[0] <= x < right <= SAFE[2] and SAFE[1] <= y < bottom <= SAFE[3]


def lines_for(text, font, width):
    lines = []
    for paragraph in text.split('\n'):
        line = ''
        for word in paragraph.split():
            candidate = f'{line} {word}'.strip()
            if font.getlength(candidate) <= width:
                line = candidate
            else:
                if line:
                    lines.append(line)
                if font.getlength(word) > width:
                    raise ValueError('A caption word exceeds the safe width')
                line = word
        if line:
            lines.append(line)
    return lines


def design(plan, folder):
    from PIL import Image, ImageDraw, ImageFont
    import srt
    folder.mkdir(parents=True, exist_ok=True)
    canvas = Image.new('RGBA', (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    boxes = []

    def label(text, x, y, size, color='#20201e', max_width=648):
        font = ImageFont.truetype(str(FONT), size)
        if font.getlength(text) > max_width:
            raise ValueError('Reel heading exceeds mobile safe width')
        box = draw.textbbox((x, y), text, font=font)
        assert within_safe(box), box
        draw.text((x, y), text, font=font, fill=color)
        boxes.append({'text': text, 'bounds': list(box)})

    label('ARCHIVE PILATES', 148, 220, 29)
    draw.rectangle((148, 272, 218, 279), fill='#b52d25')
    assert len(plan['hook']) == 2
    for index, text in enumerate(plan['hook']):
        label(text, 148, 300 + index * 72, 56)
    label(plan['subtitle'], 148, 460, 28, '#6c6b67')
    x, y, width, height = VIDEO
    draw.rectangle((x, y, x+width-1, y+height-1), fill=(0, 0, 0, 0))
    canvas.save(folder / 'layout.png')
    captions = folder / 'caption-images'
    captions.mkdir(exist_ok=True)
    entries, bounds, previous = ['ffconcat version 1.0'], [], 0.0
    body = plan['end'] - plan['start']

    def segment(start, end, text):
        if end <= start:
            return
        picture = Image.new('RGBA', (CAPTION[2], CAPTION[3]), BACKGROUND)
        paint = ImageDraw.Draw(picture)
        font = ImageFont.truetype(str(FONT), 50)
        lines = lines_for(text, font, 652)
        if len(lines) > 3:
            raise ValueError('Caption exceeds three safe-area lines')
        top = (190 - len(lines) * 56) // 2
        for index, line in enumerate(lines):
            left = round((680 - font.getlength(line)) / 2)
            box = paint.textbbox((left, top + index*56), line, font=font)
            absolute = (box[0]+132, box[1]+1230, box[2]+132, box[3]+1230)
            assert within_safe(absolute), absolute
            paint.text((left, top+index*56), line, font=font, fill='#20201e')
            bounds.append({'start': start, 'end': end, 'text': line, 'bounds': list(absolute)})
        name = f'caption-images/{len(entries):04d}.png'
        picture.save(folder / name)
        entries.extend([f"file '{name}'", 'option framerate 30', f'duration {end-start:.6f}'])

    for start, end, text in plan['cues']:
        assert 0 <= previous <= start < end <= body + .001
        segment(previous, start, '')
        segment(start, end, text)
        previous = end
    segment(previous, body, '')
    last_file = next(line for line in reversed(entries) if line.startswith('file '))
    entries.extend([last_file, 'option framerate 30'])
    (folder / 'captions.ffconcat').write_text('\n'.join(entries) + '\n')
    subs = [srt.Subtitle(i+1, timedelta(seconds=a), timedelta(seconds=b), text) for i, (a,b,text) in enumerate(plan['cues'])]
    (folder / 'captions-reviewed.srt').write_text(srt.compose(subs), encoding='utf-8')
    manifest = {'version': 'mobile-safe-v1', 'safeBounds': list(SAFE), 'videoBox': list(VIDEO),
                'captionBox': list(CAPTION), 'labels': boxes, 'captions': bounds,
                'reserved': {'top': [0, 0, 1080, 200], 'right': [900, 200, 1080, 1920],
                             'bottom': [0, 1450, 1080, 1920]}, 'footer': False}
    (folder / 'layout-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return manifest


def run(args):
    subprocess.run(args, check=True)


def render(plan, folder, ending):
    if folder.exists() and any(folder.iterdir()):
        raise FileExistsError('Preserving existing render and review sidecars; use a new output folder')
    design(plan, folder)
    duration = plan['end'] - plan['start']
    clip = folder / 'source-clip.mp4'
    body = folder / 'archive-reels-test-final.mp4'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', str(plan['start']), '-i', str(plan['source']),
         '-t', str(duration), '-vf', 'scale=1920:1080', '-c:v', 'h264_videotoolbox', '-b:v', '12M',
         '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-n', str(clip)])
    width, height, x, y = plan['crop']
    vx, vy, vw, vh = VIDEO
    graph = (f'[0:v]crop={width}:{height}:{x}:{y},scale={vw}:{vh}:force_original_aspect_ratio=decrease,'
             f'pad={vw}:{vh}:(ow-iw)/2:(oh-ih)/2:color=0xfaf9f7,'
             f'pad=1080:1920:{vx}:{vy}:color=0xfaf9f7[v];'
             '[v][1:v]overlay=0:0[base];[base][2:v]overlay=132:1230:eof_action=pass[out]')
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(clip), '-loop', '1', '-i', str(folder / 'layout.png'),
         '-f', 'concat', '-safe', '0', '-i', str(folder / 'captions.ffconcat'), '-filter_complex', graph,
         '-map', '[out]', '-map', '0:a:0', '-af', f'loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.06,afade=t=out:st={duration-.3}:d=0.3',
         '-r', '30', '-t', str(duration), '-c:v', 'h264_videotoolbox', '-b:v', '9M', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-n', str(body)])
    graph = (f'[0:v]fps=30,setsar=1,setpts=PTS-STARTPTS,fade=t=out:st={duration-.22}:d=0.22:color=0xfaf9f7[v0];'
             '[1:v]fps=30,scale=800:1422,pad=1080:1920:72:120:color=0xfaf9f7,setsar=1,setpts=PTS-STARTPTS[v1];'
             '[0:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a0];'
             '[1:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a1];'
             '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]')
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(body), '-i', str(ending), '-filter_complex', graph,
         '-map', '[v]', '-map', '[a]', '-c:v', 'h264_videotoolbox', '-b:v', '8M', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-n', str(folder / 'review-short.mp4')])
