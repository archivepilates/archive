from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "아카이브필라테스_정규직_근로계약서_2026_v7.pdf"
FONT_PATH = "/System/Library/Fonts/Supplemental/AppleGothic.ttf"

pdfmetrics.registerFont(TTFont("AppleGothic", FONT_PATH))
pdfmetrics.registerFont(TTFont("AppleGothic-Bold", FONT_PATH))

PAGE_W, PAGE_H = A4
LEFT = 20 * mm
RIGHT = 20 * mm
TOP = 15 * mm
BOTTOM = 18 * mm


def page_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("AppleGothic", 7)
    canvas.setFillColor(colors.HexColor("#6A6A6A"))
    canvas.drawString(LEFT, 7 * mm, "아카이브필라테스 | 정규직 근로계약서 2026")
    canvas.drawRightString(PAGE_W - RIGHT, 7 * mm, str(doc.page))
    canvas.restoreState()


doc = BaseDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    leftMargin=LEFT,
    rightMargin=RIGHT,
    topMargin=TOP,
    bottomMargin=BOTTOM,
    title="아카이브필라테스 정규직 근로계약서 2026",
    author="아카이브필라테스",
)
frame = Frame(LEFT, BOTTOM, PAGE_W - LEFT - RIGHT, PAGE_H - TOP - BOTTOM, id="main")
doc.addPageTemplates([PageTemplate(id="contract", frames=[frame], onPage=page_footer)])

title_style = ParagraphStyle(
    "title",
    fontName="AppleGothic-Bold",
    fontSize=18,
    leading=22,
    alignment=TA_CENTER,
    spaceAfter=7 * mm,
    textColor=colors.HexColor("#111111"),
)
page_title_style = ParagraphStyle(
    "page_title",
    fontName="AppleGothic-Bold",
    fontSize=14,
    leading=18,
    alignment=TA_CENTER,
    spaceAfter=6 * mm,
    textColor=colors.HexColor("#111111"),
)
intro_style = ParagraphStyle(
    "intro",
    fontName="AppleGothic",
    fontSize=8.4,
    leading=12.4,
    alignment=TA_LEFT,
    spaceAfter=3.6 * mm,
    textColor=colors.HexColor("#333333"),
    wordWrap="CJK",
)
heading_style = ParagraphStyle(
    "heading",
    fontName="AppleGothic-Bold",
    fontSize=9.6,
    leading=12.2,
    alignment=TA_LEFT,
    spaceBefore=1.5 * mm,
    spaceAfter=0.9 * mm,
    textColor=colors.HexColor("#111111"),
)
body_style = ParagraphStyle(
    "body",
    fontName="AppleGothic",
    fontSize=7.85,
    leading=11.45,
    alignment=TA_LEFT,
    spaceAfter=0.55 * mm,
    textColor=colors.HexColor("#222222"),
    wordWrap="CJK",
)
small_style = ParagraphStyle(
    "small",
    fontName="AppleGothic",
    fontSize=7.15,
    leading=9.8,
    alignment=TA_LEFT,
    textColor=colors.HexColor("#555555"),
    wordWrap="CJK",
)
table_text = ParagraphStyle(
    "table_text",
    fontName="AppleGothic",
    fontSize=7.7,
    leading=10.2,
    alignment=TA_LEFT,
    textColor=colors.HexColor("#222222"),
    wordWrap="CJK",
)
table_head = ParagraphStyle(
    "table_head",
    fontName="AppleGothic-Bold",
    fontSize=7.8,
    leading=10.2,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#111111"),
)


def p(text, style=body_style):
    return Paragraph(text, style)


def section(title, paragraphs):
    return KeepTogether([p(title, heading_style), *[p(text) for text in paragraphs]])


def ruled_table(rows, widths, heights=None, header=True, left_labels=False):
    table = Table(rows, colWidths=widths, rowHeights=heights)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#B7B7B7")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F1F1")))
    if left_labels:
        style.append(("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F7F7F7")))
    table.setStyle(TableStyle(style))
    return table


story = [
    p("아카이브필라테스 정규직 근로계약서", title_style),
    p(
        "아카이브필라테스(이하 '회사')와 근로자(이하 '근로자')는 근로조건과 상호 권리·의무를 명확히 하기 위해 다음과 같이 근로계약을 체결합니다.",
        intro_style,
    ),
    section(
        "제1조 (목적과 용어)",
        [
            "1. 본 계약은 회사와 근로자 사이의 근로조건, 업무 범위, 권리와 의무를 정함을 목적으로 합니다.",
            "2. '수업'은 그룹 또는 프라이빗 운동지도를, '회원정보'는 회원의 신원·연락처·건강·예약·결제·수업기록 등 업무상 취득한 정보를 말합니다.",
        ],
    ),
    section(
        "제2조 (계약 기간 및 수습)",
        [
            "1. 근로계약 기간은 아래와 같습니다. 종료일을 정하지 않은 경우 기간의 정함이 없는 근로계약으로 봅니다.",
            "2. 입사일부터 1개월은 수습기간으로 합니다. 수습기간도 근속기간과 유급 근로기간에 포함하며 월 보장급여를 동일하게 적용합니다.",
        ],
    ),
    ruled_table(
        [
            [p("근로 시작일", table_head), p("근로 종료일", table_head)],
            ["", ""],
        ],
        [82 * mm, 82 * mm],
        [7 * mm, 11 * mm],
    ),
    Spacer(1, 2 * mm),
    section(
        "제3조 (담당 업무 및 근무 장소)",
        [
            "1. 담당 업무는 그룹·프라이빗 운동지도, 수업 준비와 정리, 회원관리, 수업기록 및 리포트 작성, 근무지 위생·안전관리, 운동 콘텐츠 연구·제작 및 합리적으로 지정된 관련 운영 업무입니다.",
            "2. 주된 근무지는 부산광역시 강서구 명지국제2로28번길 34, 7층 704호 아카이브필라테스이며, 업무상 필요한 경우 사전 협의하여 근무 장소를 조정할 수 있습니다.",
        ],
    ),
    section(
        "제4조 (근로일, 근로시간 및 휴게시간)",
        [
            "1. 소정근로일은 월요일부터 토요일까지이며, 소정근로시간은 휴게시간을 제외하고 주 40시간입니다.",
            "2. 일별 근무 시작·종료 시각과 휴게시간은 회사와 근로자가 사전 협의한 월별 근무표로 정합니다. 회사는 최초 근무표를 근로 개시 전에, 이후 근무표와 변경 사항을 적용 전에 서면 또는 전자문서로 교부합니다. 해당 근무표는 본 계약의 부속 문서로 보관하며 주 40시간 범위에서 운영합니다.",
            "3. 주 40시간을 초과하는 근로와 야간·휴일근로는 사전 협의를 원칙으로 하며, 관계 법령 또는 별도 합의에 따라 수당을 지급합니다.",
            "4. 휴게시간은 근로시간 도중에 부여하며 근로자가 자유롭게 이용합니다. 4시간 근로 시 30분 이상, 8시간 근로 시 1시간 이상을 부여합니다.",
        ],
    ),
    Spacer(1, 2 * mm),
    section(
        "제5조 (유급휴일 및 휴가)",
        [
            "1. 1주간의 소정근로일을 개근한 경우 일요일을 유급주휴일로 합니다. 운영상 필요한 경우 당사자 간 서면 합의로 다른 날로 대체할 수 있습니다.",
            "2. 공휴일, 연차유급휴가, 출산·육아 관련 휴가와 그 밖의 휴가는 관계 법령이 적용되는 범위 및 회사의 별도 유급휴가 기준에 따릅니다.",
        ],
    ),
    section(
        "제6조 (입사 교육 및 직무평가)",
        [
            "1. 입사 후 4주간 아카이브필라테스 수업 기준, 회원 응대, 안전, 기록 및 운영 시스템에 관한 직무교육을 운영합니다. 회사가 참여를 요구한 교육시간은 유급 근로시간입니다.",
            "2. 교육 종료 후 수업 수행능력, 회원 응대, 안전 준수 및 운영 기준 준수 여부를 객관적으로 평가하고 기록합니다. 계약 종료가 필요한 경우 관계 법령과 정당한 절차를 따릅니다.",
        ],
    ),
    PageBreak(),
    p("임금·복리후생·안전", page_title_style),
    section(
        "제7조 (임금과 수업량)",
        [
            "1. 월 보장급여는 세전 금 2,500,000원이며 주휴수당을 포함합니다. 본 근로계약상 월 수업량은 최대 80회입니다.",
            "2. 실제 수업량이 80회보다 적더라도 회사의 편성 또는 운영 사정으로 인한 경우 월 보장급여를 감액하지 않습니다.",
            "3. 월 80회를 초과하는 수업은 본 계약상 의무가 아니며 근로자는 자유롭게 거절할 수 있습니다. 초과 업무를 수행하는 경우 업무 내용과 보수는 사전에 별도 서면 합의합니다.",
            "4. 월 보장급여는 수업 진행 외에 회사가 지시한 수업 준비·정리, 회원관리, 기록, 교육 및 운영 업무에 대한 임금을 포함합니다.",
            "5. 연장·야간·휴일근로수당과 그 밖의 법정 가산수당은 월 보장급여와 구분하여 관계 법령 및 별도 합의에 따라 산정합니다.",
        ],
    ),
    section(
        "제8조 (임금 산정 및 지급)",
        [
            "1. 임금 산정기간은 매월 1일부터 말일까지이며, 지급일은 익월 10일입니다. 지급일이 휴일이면 직전 영업일에 지급할 수 있습니다.",
            "2. 임금은 근로자 명의 계좌로 지급하고 회사는 임금명세서를 교부합니다.",
            "3. 급여 산정기간 중 입사 또는 퇴사한 경우 월 급여를 해당 기간의 총 일수로 나눈 뒤 재직일수를 곱하여 일할 계산합니다.",
            "4. 소득세, 지방소득세, 4대보험 근로자 부담분 등 법령상 공제 항목은 임금에서 공제합니다.",
        ],
    ),
    section(
        "제9조 (사회보험 및 퇴직급여)",
        [
            "1. 회사는 근로자를 고용보험, 산재보험, 국민연금 및 건강보험에 가입시키며 보험료는 관계 법령에 따라 부담합니다.",
            "2. 퇴직급여는 월 보장급여에 포함하지 않으며, 법정 요건을 충족한 경우 근로자퇴직급여 보장법에 따라 별도로 지급합니다.",
        ],
    ),
    section(
        "제10조 (안전보건 및 상호 협력)",
        [
            "1. 회사는 업무 장소의 위험요소와 동선, 기구·보호장치 사용, 업무 전 점검, 정리·청소 및 비상대응 절차를 안내하고 필요한 안전조치를 제공합니다.",
            "2. 근로자는 회사의 안전·보건 지침과 회원 보호 절차를 준수하고, 사고 또는 위험을 인지하면 즉시 회사에 보고합니다.",
            "3. 회사와 근로자는 업무 중 안전사고를 예방하기 위해 상호 성실히 협력합니다.",
        ],
    ),
    section(
        "제11조 (계약 내용의 변경)",
        [
            "1. 계약 내용을 변경할 때에는 당사자 간 서면 합의를 원칙으로 하며, 변경일과 효력 발생일을 명시합니다.",
            "2. 변경된 계약 또는 부속합의서는 전자문서로 작성하여 회사와 근로자가 각각 보관합니다.",
        ],
    ),
    section(
        "제12조 (손해배상)",
        [
            "회사 또는 근로자가 정당한 이유 없이 본 계약을 위반하거나 고의·과실로 상대방에게 실제 손해를 발생시킨 경우 관계 법령에 따라 책임을 부담합니다. 근로계약 불이행에 대한 위약금이나 손해배상액을 미리 정하지 않습니다.",
        ],
    ),
    section(
        "제13조 (비밀유지 및 개인정보 보호)",
        [
            "1. 근로자는 회원정보, 가격·매출·예약정보, 수업자료, 운영매뉴얼 및 그 밖의 영업비밀을 재직 중과 퇴직 후에도 무단 이용·복제·공개하지 않습니다.",
            "2. 회사는 근로자의 개인정보를 인사·급여·보험·법정의무 이행에 필요한 범위에서 처리합니다.",
        ],
    ),
    section(
        "제14조 (겸업 제한 및 경업·회원유인 금지)",
        [
            "1. 근로시간 외의 겸업은 원칙적으로 허용합니다. 다만, 회사 업무 수행에 실질적 지장을 주거나 안전·건강·수업 품질을 저해하는 활동, 회사와 직접 경쟁하는 필라테스·운동시설의 운영 또는 근무, 이해충돌이 발생하는 활동은 사전에 회사에 알리고 서면 협의해야 합니다.",
            "2. 근로자는 재직 중 회사의 회원을 외부 수업이나 경쟁업체로 유인하거나, 회사의 회원정보·가격정보·수업자료·영업비밀을 이용하여 본인 또는 제3자의 영업을 해서는 안 됩니다.",
            "3. 근로자는 계약 종료 후 12개월 동안 재직 중 직접 담당했거나 업무상 정보를 취득한 회사의 회원·상담고객·직원을 본인 또는 제3자의 외부 수업, 경쟁업체 또는 유사 사업으로 유인하거나 계약 전환을 권유해서는 안 됩니다.",
            "4. 근로자가 계약 종료 전 12개월 동안 회사의 회원관계, 가격정책, 수업자료, 운영매뉴얼 또는 영업전략에 실질적으로 접근한 경우, 계약 종료 후 12개월 동안 회사 주된 사업장 반경 3km 내에서 경쟁 필라테스·운동시설을 개설·운영·공동운영하거나, 위 보호정보와 고객관계를 이용하는 동일·유사 핵심직무에 종사하지 않습니다. 다만 회사가 사전에 서면으로 동의한 경우에는 적용하지 않습니다.",
        ],
    ),
    PageBreak(),
    p("콘텐츠·계약 종료 및 서명", page_title_style),
    Spacer(1, 2 * mm),
    section(
        "제15조 (초상·성명·음성 등의 이용)",
        [
            "1. 회사는 근로자의 명예와 인격권을 침해하는 방식으로 근로자의 초상·성명·음성 등을 이용하지 않습니다.",
            "2. 홍보물, 유료 콘텐츠 또는 계약 종료 후 상업적 이용은 사용 목적·매체·범위·기간·대가를 정한 별도 촬영·활용 동의에 따릅니다.",
            "3. 촬영·제작된 결과물의 저작재산권 귀속은 제16조에 따르며, 이는 근로자의 초상·성명·음성에 관한 인격적 권리의 이전을 의미하지 않습니다.",
        ],
    ),
    section(
        "제16조 (업무상 창작물)",
        [
            "1. 회사가 기획·지시하고 근로자가 직무 수행 중 작성·제작한 수업안, 시퀀스 노트, 운영 문서, 이미지, 영상, 교육자료 및 그 밖의 업무상 저작물·창작물의 저작재산권은 별도 서면합의가 없는 한 회사에 귀속합니다.",
            "2. 회사에 귀속되는 저작재산권에는 복제권, 공연권, 공중송신권, 전시권, 배포권, 대여권 및 2차적저작물작성권이 포함됩니다. 회사는 사업 운영, 교육, 홍보 및 콘텐츠 제공을 위해 재직 중과 계약 종료 후에도 해당 창작물을 이용·편집·제작할 수 있습니다.",
            "3. 저작인격권은 관계 법령에 따라 근로자에게 귀속합니다. 근로자는 회사가 본 조의 목적과 범위에서 창작물을 이용·편집하는 데 필요한 한도에서 저작인격권을 행사하지 않으며, 회사는 근로자의 명예를 훼손하거나 창작물의 본질을 부당하게 왜곡해서는 안 됩니다.",
            "4. 근로자가 입사 전에 보유한 자료, 일반적인 운동기법·경력상 노하우 또는 회사의 기획·지시 및 직무와 무관하게 창작한 자료는 근로자에게 귀속합니다. 다만 회사 업무에 사용하려는 경우 이용 범위를 별도 서면으로 정합니다.",
        ],
    ),
    section(
        "제17조 (계약의 종료)",
        [
            "1. 해고, 사직, 계약기간 만료와 관련한 절차·예고·서면통지는 관계 법령에 따릅니다.",
            "2. 근로자가 사직하려는 경우 원활한 인수인계를 위해 원칙적으로 30일 전에 회사에 알리고, 회사와 인수인계 일정을 협의합니다.",
            "3. 계약 종료 시 회사의 회원정보, 자료, 계정, 장비 및 그 복제물을 반환하거나 회사 지시에 따라 안전하게 삭제합니다.",
        ],
    ),
    section(
        "제18조 (분쟁 해결 및 부속합의)",
        [
            "1. 분쟁이 발생하면 당사자는 먼저 상호 협의하여 해결하도록 노력합니다. 해결되지 않는 경우 관계 법령에 따른 관할기관 또는 법원에서 처리합니다.",
            "2. 수업 일정, 직무 범위, 콘텐츠 이용 등 추가 사항은 본 계약에 위반되지 않는 범위에서 부속합의서로 정할 수 있습니다.",
        ],
    ),
    section(
        "제19조 (준용 및 계약서 교부)",
        [
            "1. 본 계약에 정하지 않은 사항은 취업규칙, 당사자 합의 및 관계 법령에 따릅니다.",
            "2. 회사는 서명 완료된 계약서 1부를 전자문서 형태로 근로자에게 교부하며 당사자는 각 1부씩 보관합니다.",
        ],
    ),
    Spacer(1, 7 * mm),
    p("당사자는 본 계약의 모든 내용을 확인하고 이해하였으며, 상호 합의하여 전자서명합니다.", intro_style),
]

signature_rows = [
    [p("계약 체결일", table_text), ""],
    [p("회사", table_head), p("상호: 아카이브필라테스<br/>사업자등록번호: 366-18-01791<br/>대표자: 배민진<br/>사업장 주소: 부산광역시 강서구 명지국제2로28번길 34, 7층 704호", table_text)],
    [p("회사 도장", table_text), ""],
    [p("근로자 성명", table_text), ""],
    [p("생년월일", table_text), ""],
    [p("연락처", table_text), ""],
    [p("주소", table_text), ""],
    [p("근로자 서명", table_text), ""],
]
story.extend(
    [
        ruled_table(
            signature_rows,
            [42 * mm, 122 * mm],
            [10 * mm, 19 * mm, 16 * mm, 9 * mm, 9 * mm, 9 * mm, 13 * mm, 15 * mm],
            header=False,
            left_labels=True,
        ),
        Spacer(1, 3.5 * mm),
        p(
            "※ 회사는 계약기간을 확인하고 월별 근무표를 사전 교부합니다. 전자서명 완료본은 회사와 근로자에게 각각 교부됩니다.",
            small_style,
        ),
    ]
)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc.build(story)
print(OUTPUT)
