from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "강사회원가입서_2026개정안.pdf"
LOGO = ROOT / "archivein" / "logo120.png"
FONT_PATH = Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf")

BRAND_RED = colors.HexColor("#E8281D")
INK = colors.HexColor("#151515")
MUTED = colors.HexColor("#5F6368")
LINE = colors.HexColor("#C9CDD2")
SOFT = colors.HexColor("#F5F5F3")
WARM = colors.HexColor("#FFFDFA")


def register_fonts():
    pdfmetrics.registerFont(TTFont("ArchiveKorean", str(FONT_PATH)))


def para(text, style):
    return Paragraph(text, style)


def line_field(label, width=52 * mm):
    return para(f"<b>{label}</b><br/><br/>________________________________", STYLES["field"])


def field_cell(label):
    return para(
        f"<b>{label}</b><br/><br/>________________________________________",
        STYLES["field"],
    )


def section_title(text):
    return Table(
        [[para(text, STYLES["section"]) ]],
        colWidths=[176 * mm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SOFT),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        ),
    )


def header(title, subtitle):
    logo = Table([[""]], colWidths=[16 * mm], rowHeights=[16 * mm])
    if LOGO.exists():
        from reportlab.platypus import Image

        logo = Image(str(LOGO), width=15 * mm, height=15 * mm)

    title_block = [
        para(title, STYLES["title"]),
        para(subtitle, STYLES["subtitle"]),
    ]
    table = Table([[logo, title_block]], colWidths=[21 * mm, 155 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return table


def checkbox_row(items, note=None):
    text = "&nbsp;&nbsp;&nbsp;&nbsp;".join(f"□ {item}" for item in items)
    if note:
        text += f"<br/><font color='#5F6368'>{note}</font>"
    return para(text, STYLES["body"])


def selection_box(note=None):
    table = Table([[""]], colWidths=[176 * mm], rowHeights=[12 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("BACKGROUND", (0, 0), (-1, -1), WARM),
            ]
        )
    )
    if not note:
        return table
    return KeepTogether([table, Spacer(1, 1.5 * mm), para(note, STYLES["small"])])


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, 14 * mm, 192 * mm, 14 * mm)
    canvas.setFont("ArchiveKorean", 7.4)
    canvas.setFillColor(INK)
    canvas.drawString(18 * mm, 9 * mm, "ARCHIVE PILATES")
    canvas.setFillColor(MUTED)
    canvas.drawRightString(192 * mm, 9 * mm, f"강사회원 등록 및 계속 이용 동의  ·  {doc.page}")
    canvas.restoreState()


def build_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            parent=base["Normal"],
            fontName="ArchiveKorean",
            fontSize=18,
            leading=22,
            textColor=INK,
            alignment=TA_LEFT,
            spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontName="ArchiveKorean",
            fontSize=8,
            leading=11,
            textColor=MUTED,
        ),
        "section": ParagraphStyle(
            "section",
            parent=base["Normal"],
            fontName="ArchiveKorean",
            fontSize=10,
            leading=13,
            textColor=INK,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="ArchiveKorean",
            fontSize=9.1,
            leading=14.2,
            textColor=INK,
            wordWrap="CJK",
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["Normal"],
            fontName="ArchiveKorean",
            fontSize=8.1,
            leading=12.2,
            textColor=MUTED,
            wordWrap="CJK",
        ),
        "field": ParagraphStyle(
            "field",
            parent=base["Normal"],
            fontName="ArchiveKorean",
            fontSize=9.2,
            leading=12.8,
            textColor=INK,
        ),
        "consent": ParagraphStyle(
            "consent",
            parent=base["Normal"],
            fontName="ArchiveKorean",
            fontSize=8.65,
            leading=13.2,
            textColor=INK,
            wordWrap="CJK",
        ),
        "center": ParagraphStyle(
            "center",
            parent=base["Normal"],
            fontName="ArchiveKorean",
            fontSize=8.4,
            leading=12,
            textColor=INK,
            alignment=TA_CENTER,
        ),
    }


def info_table():
    rows = [
        [field_cell("이름"), field_cell("생년월일")],
        [field_cell("연락처"), field_cell("소속 센터")],
        [field_cell("강사 경력"), field_cell("주소")],
    ]
    table = Table(rows, colWidths=[88 * mm] * 2, rowHeights=[25 * mm, 25 * mm, 25 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.45, LINE),
                ("BACKGROUND", (0, 0), (-1, -1), WARM),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return table


def operator_table():
    rows = [[field_cell("가입 상품명"), field_cell("결제 금액")]]
    table = Table(rows, colWidths=[88 * mm] * 2, rowHeights=[26 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.8, BRAND_RED),
                ("INNERGRID", (0, 0), (-1, -1), 0.45, LINE),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF5F2")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return table


def page_one(story):
    story.extend(
        [
            header("ARCHIVE PILATES 강사 회원 가입서", "강사 회원 수업 신청 및 촬영본 이용 안내"),
            Spacer(1, 5 * mm),
            section_title("1. 회원 정보"),
            Spacer(1, 2 * mm),
            info_table(),
            Spacer(1, 4 * mm),
            section_title("2. ARCHIVE PILATES 공식 홈페이지 가입 확인"),
            Spacer(1, 2.5 * mm),
            selection_box(
                "강의 촬영본은 공식 홈페이지 회원에게만 제공합니다.",
            ),
            Spacer(1, 1.5 * mm),
            para(
                "가입 정보의 <b>이름과 연락처는 본 신청서와 동일하게</b> 입력해 주세요. "
                "수업일까지 가입이 확인되지 않으면 강의 촬영본 제공이 보류됩니다. "
                "홈페이지 계정 비밀번호는 수집하지 않습니다.",
                STYLES["body"],
            ),
            Spacer(1, 4 * mm),
            section_title("3. 가입 상품 및 결제 · ARCHIVE PILATES 작성 영역"),
            Spacer(1, 2 * mm),
            operator_table(),
            Spacer(1, 1 * mm),
            para(
                "이 영역은 ARCHIVE PILATES가 문서를 보내기 전에 작성합니다. 강사회원은 입력된 상품명과 결제 금액을 확인합니다.",
                STYLES["small"],
            ),
            Spacer(1, 4 * mm),
            section_title("4. 재수강 및 동의 연장"),
            Spacer(1, 2.5 * mm),
            para(
                "본 신청서와 2쪽의 필수 촬영 동의는 <b>최초 서명일부터 강사회원 자격이 유지되는 동안 적용</b>됩니다. "
                "재수강 또는 추가 수강권 등록 시 별도 재작성 없이 마지막 수업일까지 연장됩니다. "
                "다만 동의 목적·범위가 실질적으로 변경되거나, 동의를 철회한 뒤 재수강하거나, 마지막 수업일로부터 3년이 지난 뒤 다시 등록하는 경우에는 새 동의를 받습니다. "
                "이름·연락처·소속 센터 등이 바뀐 경우에는 변경 정보만 갱신합니다.",
                STYLES["body"],
            ),
            para(
                "다음 페이지의 이용 약관과 동의 내용을 확인한 뒤 마지막 페이지에서 한 번 서명합니다.",
                STYLES["center"],
            ),
        ]
    )


def page_two(story):
    story.extend(
        [
            PageBreak(),
            header("이용 약관 및 필수 촬영 동의", "강사레슨 참여 전 확인해야 하는 필수 내용입니다"),
            Spacer(1, 4 * mm),
            section_title("5. 이용 약관"),
            Spacer(1, 2.5 * mm),
            para(
                "<b>변경 및 취소</b><br/>"
                "- 원활한 수업 운영을 위해 수업일 7일 전까지 변경 또는 취소할 수 있습니다.<br/>"
                "- 강사레슨 수업은 수업일 7일 전부터 변경 또는 취소가 제한될 수 있습니다.<br/><br/>"
                "<b>안전 및 이용 책임</b><br/>"
                "- 본인의 건강 상태와 운동 가능 여부를 확인하고, 수업 중 불편이나 통증이 있으면 즉시 강사에게 알립니다.<br/>"
                "- 이용 방법과 강사의 안전 지침을 따르지 않아 발생한 사고, 회원 개인의 부주의, 시설 또는 기물의 고의·과실 손상은 본인 책임이 될 수 있습니다.<br/>"
                "- 타 회원에게 반복적으로 불편이나 피해를 주는 경우 이용이 제한될 수 있습니다.",
                STYLES["body"],
            ),
            Spacer(1, 5 * mm),
            section_title("A. 촬영 및 강의 콘텐츠 제작·판매·소개 활용"),
            Spacer(1, 3 * mm),
            para(
                "본 강사레슨은 촬영, 교육 콘텐츠 제작·제공·판매와 해당 콘텐츠의 소개·홍보 활용을 전제로 운영됩니다. "
                "본인은 촬영된 얼굴·신체 움직임·음성·실습 장면과 필요한 범위의 성명이 다음과 같이 이용되는 것에 동의합니다.<br/><br/>"
                "<b>1) 이용 목적</b>  수업 복습용 촬영본 제공, 강의·교육 콘텐츠의 제작·편집·배포·판매, 해당 강의와 관련 서비스의 소개·홍보<br/>"
                "<b>2) 적용 수업</b>  최초 동의 이후 강사회원 자격 기간에 참여하는 강사레슨과 재수강 수업<br/>"
                "<b>3) 이용 범위</b>  ARCHIVE PILATES 공식 홈페이지의 회원 전용 또는 유료 강의 페이지, 온라인·오프라인 교육 콘텐츠, 해당 강의 소개를 위한 공식 홈페이지·유튜브·인스타그램·블로그·온라인 광고·인쇄물<br/>"
                "<b>4) 편집 범위</b>  분량 조정, 자막·음향, 화면 분할·확대·크롭, 수업 흐름에 필요한 재구성<br/>"
                "<b>5) 동의 유효기간</b>  최초 서명일부터 강사회원 자격 유지 기간까지이며, 재수강 시 마지막 수업일까지 연장됩니다.<br/>"
                "<b>6) 촬영물 이용기간</b>  각 촬영일로부터 3년. 기간 이후 재사용이 필요한 경우 별도 동의를 받습니다.<br/>"
                "<b>7) 제공 조건</b>  촬영본 열람은 공식 홈페이지 가입 확인 후 부여하며, 계정 공유·무단 복제·재배포를 금지합니다.<br/>"
                "<b>8) 철회·재동의</b>  제작·배포 전에는 서면 또는 전자 방식으로 철회할 수 있습니다. 목적·범위가 변경되거나 철회 후 재수강하거나 마지막 수업일로부터 3년 후 재등록하면 새 동의를 받습니다. 이미 제작·판매·배포된 콘텐츠는 즉시 회수가 어려울 수 있으며, 가능한 범위에서 조치합니다.<br/>"
                "<b>9) 보상</b>  본 동의에 따른 초상·음성 이용에 별도의 금전 보상은 없으며, 별도 합의가 있는 경우 그 합의를 따릅니다.<br/>"
                "<b>10) 거부 시 안내</b>  동의를 거부할 수 있으나, 필수 동의에 동의하지 않으면 강사레슨을 신청하거나 수강할 수 없습니다.",
                STYLES["consent"],
            ),
            Spacer(1, 3 * mm),
            checkbox_row(["동의함", "동의하지 않음"]),
            Spacer(1, 3 * mm),
            para(
                "필수 동의에 동의하지 않으면 강사레슨을 신청하거나 수강할 수 없습니다.",
                STYLES["small"],
            ),
            PageBreak(),
            header("개인정보 동의 및 서명", "개인정보 처리 내용을 확인하고 서명합니다"),
            Spacer(1, 5 * mm),
            section_title("B. 개인정보 수집·이용 동의"),
            Spacer(1, 3 * mm),
            para(
                "<b>수집 항목</b>  이름, 생년월일, 연락처, 소속 센터, 홈페이지 가입 상태, 가입 상품·결제 금액, 서명 및 동의 기록. 선택 수집 항목은 강사 경력과 주소입니다.<br/>"
                "<b>이용 목적</b>  강사 회원 등록·수업 운영·결제 및 취소 처리, 홈페이지 회원 확인과 촬영본 열람 권한 제공, 동의 이력 관리 및 분쟁 대응<br/>"
                "<b>보유 기간</b>  재수강 시 마지막 강사 회원 수업일 또는 이용권 종료일 중 늦은 날을 기준으로 갱신되며, 그 날부터 3년간 보관합니다. 관계 법령상 별도 보관 의무가 있는 정보는 해당 기간까지 보관합니다.<br/>"
                "<b>거부 권리와 불이익</b>  동의를 거부할 수 있으나, 필수 정보 처리에 동의하지 않으면 강사 회원 등록과 촬영본 제공이 제한됩니다.",
                STYLES["consent"],
            ),
            Spacer(1, 3 * mm),
            checkbox_row(["동의함", "동의하지 않음"]),
            Spacer(1, 5 * mm),
            para("본인은 위 내용을 읽고 이해했으며, 각 항목에 표시한 대로 동의합니다.", STYLES["center"]),
            Spacer(1, 4 * mm),
            Table(
                [[para("작성일&nbsp;&nbsp; ____________________", STYLES["body"]), para("성명&nbsp;&nbsp; ____________________", STYLES["body"]), para("서명&nbsp;&nbsp; ____________________", STYLES["body"])]],
                colWidths=[58 * mm, 58 * mm, 60 * mm],
                style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]),
            ),
        ]
    )


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    register_fonts()
    global STYLES
    STYLES = build_styles()
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=17 * mm,
        leftMargin=17 * mm,
        topMargin=15 * mm,
        bottomMargin=20 * mm,
        title="ARCHIVE PILATES 강사 회원 가입서 2026 개정안",
        author="ARCHIVE PILATES",
    )
    story = []
    page_one(story)
    page_two(story)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(OUTPUT)


if __name__ == "__main__":
    main()
