#!/usr/bin/env python3
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "refund" / "ARCHIVE_PILATES_환불동의서_2026-08.pdf"
LOGO = ROOT / "core" / "icons" / "archive-pilates-icon-192.png"
FONT_REGULAR = "/System/Library/Fonts/Supplemental/AppleGothic.ttf"
FONT_MEDIUM = FONT_REGULAR
FONT_BOLD = FONT_REGULAR


def draw_table(c, x, y_top, widths, row_height, rows):
    total_width = sum(widths)
    total_height = row_height * len(rows)
    c.setStrokeColor(colors.HexColor("#565656"))
    c.setLineWidth(0.7)
    c.rect(x, y_top - total_height, total_width, total_height)
    for row_index in range(1, len(rows)):
        y = y_top - row_height * row_index
        c.line(x, y, x + total_width, y)
    cursor = x
    for width in widths[:-1]:
        cursor += width
        c.line(cursor, y_top, cursor, y_top - total_height)
    for row_index, row in enumerate(rows):
        cursor = x
        for cell_index, cell in enumerate(row):
            width = widths[cell_index]
            if cell_index % 2 == 0:
                c.setFillColor(colors.HexColor("#E9E9E7"))
                c.rect(cursor, y_top - row_height * (row_index + 1), width, row_height, stroke=0, fill=1)
                c.setFillColor(colors.HexColor("#171717"))
                c.setFont("ArchiveBold", 9)
                c.drawCentredString(cursor + width / 2, y_top - row_height * row_index - row_height / 2 - 3, cell)
            cursor += width


def build_pdf():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont("ArchiveRegular", FONT_REGULAR))
    pdfmetrics.registerFont(TTFont("ArchiveMedium", FONT_MEDIUM))
    pdfmetrics.registerFont(TTFont("ArchiveBold", FONT_BOLD))
    width, height = A4
    c = canvas.Canvas(str(OUTPUT), pagesize=A4)
    c.setTitle("ARCHIVE PILATES 환불동의서")
    c.setAuthor("ARCHIVE PILATES")

    c.setFillColor(colors.white)
    c.rect(0, 0, width, height, stroke=0, fill=1)
    if LOGO.exists():
        c.drawImage(str(LOGO), 184, 770, 28, 28, mask="auto", preserveAspectRatio=True)
    c.setFillColor(colors.HexColor("#151515"))
    c.setFont("ArchiveBold", 18)
    c.drawString(220, 778, "ARCHIVE PILATES 환불동의서")
    c.setStrokeColor(colors.HexColor("#E4572E"))
    c.setLineWidth(2)
    c.line(40, 750, 555, 750)

    c.setFont("ArchiveBold", 10)
    c.setFillColor(colors.HexColor("#353535"))
    c.drawString(40, 726, "회원 정보")
    draw_table(c, 40, 714, [78, 155, 78, 204], 38, [["이름", "", "주소", ""], ["생년월일", "", "연락처", ""]])

    c.setFont("ArchiveBold", 10)
    c.drawString(40, 578, "환불 신청")
    draw_table(
        c,
        40,
        566,
        [82, 146, 82, 205],
        45,
        [["환불 사유", "", "실결제금액", ""], ["위약금", "", "사용·혜택 공제", ""], ["예상 환불금액", "", "", ""]],
    )

    # The existing eformsign template keeps separate bank and account fields.
    # Extend only the account cell so the original stable field IDs stay aligned.
    c.setStrokeColor(colors.HexColor("#565656"))
    c.setLineWidth(0.7)
    c.line(268, 431, 268, 386)
    c.line(350, 431, 350, 386)
    c.line(555, 431, 555, 386)
    c.line(268, 386, 555, 386)
    c.line(350, 421, 555, 421)
    c.setFillColor(colors.HexColor("#E9E9E7"))
    c.rect(268, 386, 82, 90, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#171717"))
    c.setFont("ArchiveBold", 9)
    c.drawCentredString(309, 428, "지급계좌")

    policy_top = 371
    policy_height = 101
    c.setFillColor(colors.HexColor("#FAF9F7"))
    c.setStrokeColor(colors.HexColor("#BBBBB5"))
    c.rect(40, policy_top - policy_height, 515, policy_height, stroke=1, fill=1)
    c.setFillColor(colors.HexColor("#171717"))
    c.setFont("ArchiveBold", 9)
    c.drawString(54, policy_top - 18, "환불 산정 기준")
    c.setFont("ArchiveRegular", 8.2)
    policy_lines = [
        "• 모든 환불은 실결제금액의 10% 위약금을 공제합니다.",
        "• 횟수권 사용분은 1회 정상 단가 × 사용 횟수로 계산합니다.",
        "• 기간권 사용분은 결제금액 × (총 계약 주수 - StudioMate 잔여 주수) ÷ 총 계약 주수로 계산합니다.",
        "• 증정·이벤트·프로모션 혜택은 별도 공제되며, 유효기간이 지난 수강권은 환불할 수 없습니다.",
        "• 최종 환불금액은 본 동의서 서명과 운영자 확인 후 확정됩니다.",
    ]
    for index, line in enumerate(policy_lines):
        c.drawString(54, policy_top - 35 - index * 13, line)

    c.setFillColor(colors.HexColor("#555555"))
    c.setFont("ArchiveRegular", 8.3)
    c.drawString(40, 255, "위 환불 산정 기준과 예상 환불금액을 확인했으며, 환불 처리를 요청합니다.")

    c.setFillColor(colors.HexColor("#222222"))
    c.setFont("ArchiveMedium", 9)
    c.drawString(40, 224, "작성일")
    c.setStrokeColor(colors.HexColor("#9A9A95"))
    c.line(90, 221, 292, 221)

    c.setFont("ArchiveMedium", 10)
    c.drawString(165, 151, "환불 신청 회원")
    c.line(252, 147, 370, 147)
    c.drawString(380, 151, "(서명 또는 인)")
    c.drawString(165, 112, "ARCHIVE PILATES")
    c.line(252, 108, 370, 108)
    c.drawString(380, 112, "(서명 또는 인)")

    c.setStrokeColor(colors.HexColor("#B6B6B0"))
    c.line(40, 68, 555, 68)
    if LOGO.exists():
        c.drawImage(str(LOGO), 40, 28, 25, 25, mask="auto", preserveAspectRatio=True)
    c.setFillColor(colors.HexColor("#222222"))
    c.setFont("ArchiveBold", 10)
    c.drawString(71, 36, "ARCHIVE PILATES")
    c.setFont("ArchiveRegular", 8)
    c.setFillColor(colors.HexColor("#666666"))
    c.drawRightString(555, 36, "051.2924.4425  ·  archivepilates.com")
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    build_pdf()
