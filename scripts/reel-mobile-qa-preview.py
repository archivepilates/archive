"""Local-only phone/UI stress previews. Not a YouTube app screenshot."""
import base64
import html
import json
from pathlib import Path
import cv2
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/mobile-layout-preview-top-v2'
folder = OUT / 'ach9-1126.40-1165.20-light-spring'
movie = folder / 'review-short.mp4'
manifest = json.loads((folder / 'layout-manifest.json').read_text())
font_path = str(Path.home() / 'Library/Fonts/Paperlogy-7Bold.ttf')
capture = cv2.VideoCapture(str(movie))
try:
    capture.set(cv2.CAP_PROP_POS_MSEC, 23300)
    ok, frame = capture.read()
    assert ok
    image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
finally:
    capture.release()

panels = []
for width in (320, 390, 430):
    for aspect, mode in ((16/9, 'contain'), (19.5/9, 'contain'), (20/9, 'cover')):
        height = round(width*aspect)
        phone = Image.new('RGB', (width, height), '#faf9f7')
        if mode == 'cover':
            picture = ImageOps.fit(image, (width, height))
            phone.paste(picture)
        else:
            picture = ImageOps.contain(image, (width, height))
            phone.paste(picture, ((width-picture.width)//2, (height-picture.height)//2))
        shade = Image.new('RGBA', phone.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(shade)
        draw.rectangle((0, 0, width, int(height*.16)), fill=(35,35,35,65))
        draw.rectangle((int(width*.86), int(height*.36), width, height), fill=(35,35,35,65))
        draw.rectangle((0, int(height*.76), width, height), fill=(35,35,35,85))
        font = ImageFont.truetype(font_path, max(12, round(width/28)))
        draw.text((12, 12), '상단 조작 영역', font=font, fill='white')
        draw.text((12, int(height*.84)), '채널 · 영상 제목 · 하단 메뉴 영역', font=font, fill='white')
        draw.text((int(width*.88), int(height*.51)), '공유', font=font, fill='white')
        phone = Image.alpha_composite(phone.convert('RGBA'), shade).convert('RGB')
        phone.save(OUT / f'phone-{width}-{mode}-{aspect:.3f}.jpg', quality=94)
        if width == 390 and mode == 'cover':
            phone.save(OUT / 'next-reel-mobile-preview.jpg', quality=95)
        panels.append((phone, f'{width}px · {aspect:.3f} · {mode}'))

sheet = Image.new('RGB', (1290, 2990), 'white')
draw = ImageDraw.Draw(sheet)
for i, (picture, label) in enumerate(panels):
    column, row = divmod(i, 3)
    x, y = column*430, row*990
    draw.text((x+12, y+8), label, font=ImageFont.truetype(font_path, 18), fill='#222')
    sheet.paste(picture, (x+(430-picture.width)//2, y+40))
sheet.save(OUT / 'phone-safe-area-grid.jpg', quality=93)
target = ROOT / 'docs/reports/2026-10-15-reel-mobile-top-inset.html'
target.parent.mkdir(parents=True, exist_ok=True)
preview = base64.b64encode((OUT / 'next-reel-mobile-preview.jpg').read_bytes()).decode()
page = f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCHIVE PILATES 모바일 릴스 배치</title>
<style>*{{box-sizing:border-box}}body{{margin:0;color:#222;background:#fafafa;font:16px/1.7 -apple-system,BlinkMacSystemFont,sans-serif}}main{{max-width:980px;margin:auto;padding:32px 20px}}h1{{font-size:25px}}h2{{font-size:20px}}p{{max-width:65ch;overflow-wrap:anywhere}}img{{max-width:100%;height:auto}}video{{width:100%;max-width:390px;aspect-ratio:9/16;background:#111}}a{{color:#a5262d}}</style>
<main><p>ARCHIVE PILATES · 2026-10-15</p><h1>다음 릴스부터 적용하는 모바일 안전 배치</h1>
<p>현재 <a href="https://www.youtube.com/shorts/n0-OHLw0VD4">ACH9 릴스</a>는 20:03 KST 전체공개됐으며 승인 버튼 기록과 공식 채널의 공개 상태를 독립 조회했습니다. 원래 게시 파일·제목·설명은 그대로 보존했습니다.</p>
<h2>변경한 템플릿의 로컬 시험</h2>
<p>이 샘플은 mobile-safe-v2 배치 검증용이며 업로드·재게시하지 않았습니다. 상단 예약 영역을 200px에서 320px로 확대하고 브랜드·제목·강사명을 140px 아래로 옮겼습니다. 영상 영역은 y660–1180으로 조절하고 자막·엔딩 및 하단 여유는 보존했습니다. 다음 신규 제작부터 이 렌더러를 기본 사용합니다.</p>
<h2>휴대폰 UI 겹침 시뮬레이션</h2><img width="390" alt="390px 긴 화면 채우기 가정의 UI 안전영역 시뮬레이션" src="data:image/jpeg;base64,{preview}">
<p>회색 영역은 가정한 앱 조작 영역입니다. 실제 iPhone YouTube 앱 화면이나 공식 보장 영역이 아닙니다. 맞춤/채우기와 세 화면비를 시험했으며, 네이티브 CC 위치·글자 크기·확장된 설명·기기별 앱 버전은 별도 실기기 확인이 필요합니다.</p>
<p>검증: 전체 디코딩·원본 해시 보존·편집 자막 및 엔딩 경계 검사, H.264/AAC, 음량 검사. 승인/공개 회귀 27개와 로컬 레이아웃 검사 7개 통과. 320·390·430px, 9:16·9:19.5·9:20을 조합한 9개 시뮬레이션과 실제 로컬 렌더를 확인했습니다. 로컬 샘플과 실제 공개본은 서로 다른 파일이며 공개본을 변경하지 않았습니다.</p>
<p>배포 기록: 코드·CORE 운영규칙 반영 전 검증 보고서. 반영 완료 내역은 최종 작업 보고를 기준으로 확인합니다.</p></main></html>'''
target.write_text(page, encoding='utf-8')
print(json.dumps({'report': str(target), 'preview': str(OUT / 'next-reel-mobile-preview.jpg'), 'cases': len(panels)}))
