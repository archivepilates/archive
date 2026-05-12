# Archive Pilates Design System
아카이브필라테스 디자인 시스템 — **v1.2 Reference Blend Update**

> v1.2는 기존 Archive Pilates v1.1 Mobile/TDS 시스템을 유지하면서, 새로 추가된 두 참고 시스템의 장점을 선별적으로 흡수합니다.  
> StudioBlank에서는 **여백, 절제, 이미지 중심성**을 가져오고, Verdana Health에서는 **신뢰감 있는 웰니스 UX, 폼/상태/예약 구조의 안정감**을 가져옵니다.  
> 단, 두 시스템의 색상·성격을 그대로 섞지 않고 Archive Pilates의 고유한 **warm neutral + near-black + red-orange accent** 정체성을 유지합니다.

---

## 0. Version Intent

### 목적
- 아카이브필라테스 브랜드 아이덴티티를 더 명확하게 고도화한다.
- 20–40대 여성이 선호하는 **고급스럽고 차분한 웰니스 브랜드 경험**을 만든다.
- 모바일 예약/상담/클래스 탐색 화면에서 신뢰감과 사용성을 높인다.
- 사진, 여백, 텍스트, CTA가 서로 경쟁하지 않도록 디자인 밀도를 낮춘다.

### 이번 업데이트의 핵심 문장

> Archive Pilates는 StudioBlank의 조용한 여백과 사진 중심 태도, Verdana Health의 안정적인 웰니스 UX 구조를 흡수하되, 색상과 감성은 Archive 고유의 웜 뉴트럴과 레드오렌지 액센트를 유지한다.

---

## 1. Reference Strategy

### 1.1 StudioBlank에서 가져올 것
StudioBlank는 극단적으로 절제된 포트폴리오형 시스템입니다. Archive Pilates에서는 다음 요소만 흡수합니다.

| 가져올 요소 | Archive 적용 방식 |
|---|---|
| 넓은 여백 | 섹션 간격과 모바일 블록 간격을 더 과감하게 사용 |
| 이미지 중심성 | 공간 사진, 클래스 사진, 강사 사진이 UI보다 먼저 보이게 설계 |
| 낮은 UI 존재감 | 네비게이션, 보조 버튼, 메타 정보는 조용하게 처리 |
| 얇은 선과 단순한 구분 | 카드 남발 대신 fine divider, list rhythm 사용 |
| 장식 배제 | gradient, pattern, heavy shadow, 과한 icon 장식 금지 |

### 1.2 StudioBlank에서 가져오지 않을 것
| 피할 요소 | 이유 |
|---|---|
| 모든 radius 0px | 필라테스/웰니스 브랜드의 부드러움이 줄어듦 |
| 순수 흑백만 사용 | Archive의 웜 뉴트럴 감성과 레드오렌지 자산이 약해짐 |
| 지나치게 차가운 포트폴리오 톤 | 실제 예약/상담 서비스에는 정서적 온도가 필요 |

### 1.3 Verdana Health에서 가져올 것
Verdana Health는 신뢰감 있는 디지털 헬스 시스템입니다. Archive Pilates에서는 다음 요소를 흡수합니다.

| 가져올 요소 | Archive 적용 방식 |
|---|---|
| 안정적인 폼 구조 | 예약, 상담, 신청서 입력을 읽기 쉽게 그룹화 |
| 상태 표시 체계 | 예약 완료, 대기, 변경, 취소 상태를 명확히 구분 |
| 부드러운 radius | 카드, input, sheet에 일관된 10–16px radius 적용 |
| 접근성 중심 타이포 | 작은 설명문도 13px 이하로 무리하게 줄이지 않음 |
| progressive disclosure | 상세 정책/강사 정보/환불 안내는 bottom sheet로 분리 |

### 1.4 Verdana Health에서 가져오지 않을 것
| 피할 요소 | 이유 |
|---|---|
| Navy + Sage 컬러 조합 | Archive의 레드오렌지 포인트와 충돌 |
| 병원/검진 대시보드 분위기 | 필라테스 스튜디오의 lifestyle/premium 감성과 다름 |
| 과도한 상태 색상 | 브랜드 팔레트가 흩어지고 운영물이 복잡해짐 |

---

## 2. Brand Core

### 브랜드 키워드
- Refined Minimalism / 정제된 미니멀리즘
- Warm Precision / 따뜻한 정돈감
- Quiet Confidence / 조용한 자신감
- Body & Space / 몸과 공간의 균형
- Editorial Wellness / 에디토리얼 웰니스
- Trustworthy Flow / 신뢰감 있는 예약 경험

### 디자인 판단 기준
디자인을 만들 때 아래 순서로 판단합니다.

1. 이 화면이 Archive Pilates답게 조용하고 고급스러운가?
2. 사진과 여백이 충분히 숨을 쉬는가?
3. 사용자가 다음 행동을 쉽게 이해하는가?
4. 레드오렌지 액센트가 너무 많이 쓰이지 않았는가?
5. 병원 앱, 헬스장 앱, 일반 뷰티샵 템플릿처럼 보이지 않는가?

---

## 3. Color System

### 3.1 Palette Principle
- 색상은 확장하지 않고 **기존 Archive 팔레트의 목적성을 강화**합니다.
- 레드오렌지는 브랜드 CTA, active, progress, key highlight에만 사용합니다.
- 상태 색상은 필요할 때만 낮은 채도의 보조 토큰으로 사용합니다.
- Navy, Sage, Blue, Purple 계열은 기본 UI에서 사용하지 않습니다.

### 3.2 Core Tokens
| Token | Value | Role |
|---|---:|---|
| `--ap-bg` | `#FFFFFF` | 기본 배경 |
| `--ap-bg-warm` | `#FAF8F5` | 웜톤 페이지 배경, 브랜드 섹션 |
| `--ap-grey-bg` | `#F7F7F6` | 모바일 그룹 배경 |
| `--ap-layer` | `#FFFFFF` | 카드, 리스트, 시트 |
| `--ap-layer-warm` | `#FFF8F2` | 은은한 브랜드 강조 배경 |
| `--ap-fg1` | `#1A1A1A` | 주 텍스트 |
| `--ap-fg2` | `#454545` | 보조 텍스트 |
| `--ap-fg3` | `#767676` | 메타, placeholder |
| `--ap-fg-disabled` | `#A8A8A8` | 비활성 텍스트 |
| `--ap-primary` | `#F06B1A` | 브랜드 CTA, active |
| `--ap-primary-weak` | `#FEF0E6` | 선택 배경, weak CTA |
| `--ap-primary-pressed` | `#C85510` | pressed CTA |
| `--ap-border` | `#E5E8EB` | 기본 구분선 |
| `--ap-border-soft` | `#F0EFED` | 매우 약한 구분선 |
| `--ap-scrim` | `rgba(0,0,0,.42)` | overlay backdrop |

### 3.3 Status Tokens
상태 색상은 Verdana Health처럼 기능적으로 명확하되, Archive 팔레트 안에서 차분하게 사용합니다.

| Token | Value | Use |
|---|---:|---|
| `--ap-success` | `#2F8F5B` | 예약 완료, 결제 완료 |
| `--ap-success-bg` | `#EEF8F1` | success weak surface |
| `--ap-warning` | `#B7791F` | 대기, 확인 필요 |
| `--ap-warning-bg` | `#FFF7E8` | warning weak surface |
| `--ap-error` | `#C2412D` | 취소, 오류, destructive |
| `--ap-error-bg` | `#FFF0ED` | error weak surface |
| `--ap-info` | `#5B6470` | 일반 안내, neutral notice |
| `--ap-info-bg` | `#F3F4F5` | info weak surface |

### 3.4 Color Do / Don’t
**Do**
- 한 화면에서 브랜드 액센트는 1–2곳만 강하게 사용합니다.
- 선택 상태에는 `--ap-primary-weak`를 우선 사용하고, 최종 CTA만 `--ap-primary`를 사용합니다.
- 긴 안내문은 neutral surface에 올려 가독성을 높입니다.

**Don’t**
- 레드오렌지를 모든 아이콘, 링크, 배지에 반복하지 않습니다.
- navy/sage/blue/purple gradient를 브랜드 UI에 넣지 않습니다.
- success/warning/error를 장식용으로 사용하지 않습니다.

---

## 4. Typography

### 4.1 Type Principle
- 한국어 본문은 부드럽고 안정적으로 읽혀야 합니다.
- 모바일에서 13px 미만의 텍스트는 지양합니다.
- StudioBlank처럼 무게 대비를 활용하되, 지나치게 차갑지 않게 합니다.
- Verdana Health처럼 폼/상태/설명 텍스트는 명확한 위계를 가져야 합니다.

### 4.2 Recommended Font Stack
| Role | Font |
|---|---|
| Korean / Body | Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif |
| English / Display | Inter, Pretendard, sans-serif |
| Numeric / Operational | SF Mono, Fira Code, monospace |

### 4.3 Type Tokens
| Token | Size / Line Height | Weight | Use |
|---|---:|---:|---|
| `--ap-display` | 34 / 42 | 700 | 캠페인 히어로, 큰 브랜드 문장 |
| `--ap-title-1` | 30 / 40 | 700 | 앱 주요 화면 제목 |
| `--ap-title-2` | 26 / 35 | 700 | 일반 화면 제목 |
| `--ap-title-3` | 22 / 31 | 700 | 섹션 제목 |
| `--ap-headline` | 20 / 29 | 600 | 카드/리스트 그룹 제목 |
| `--ap-body` | 17 / 26 | 400 | 본문, 설명 |
| `--ap-body-sm` | 15 / 23 | 400 | 보조 본문 |
| `--ap-caption` | 13 / 19 | 500 | 메타, 캡션, 배지 |
| `--ap-micro` | 12 / 17 | 500 | 제한적 사용, legal/label only |

### 4.4 Copy Tone
| Use | Good | Avoid |
|---|---|---|
| CTA | 예약하기 | 지금 바로 예약하세요! |
| 안내 | 수업을 선택해주세요 | 나에게 딱 맞는 완벽한 수업을 찾아보세요! |
| 완료 | 예약 정보가 저장되었습니다 | 성공적으로 완료되었습니다!!! |
| 오류 | 다시 시도해주세요 | 에러가 발생했습니다 |
| 브랜드 | 몸과 공간의 균형 | 프리미엄 필라테스의 모든 것 |

---

## 5. Spacing & Layout

### 5.1 Spacing Principle
- StudioBlank의 여백 원칙을 Archive에 맞게 부드럽게 적용합니다.
- 모바일에서는 과도하게 비우기보다 **숨 쉴 수 있는 흐름**을 만듭니다.
- 웹/포스터/브랜드 이미지에서는 여백을 더 과감하게 사용합니다.

### 5.2 Scale
`4px · 8px · 12px · 16px · 20px · 24px · 32px · 48px · 64px · 96px · 128px`

### 5.3 Mobile Tokens
| Token | Value | Use |
|---|---:|---|
| `--ap-mobile-gutter` | 24px | 좌우 기본 여백 |
| `--ap-mobile-gutter-tight` | 20px | 정보 밀도 높은 화면 |
| `--ap-block-gap` | 24px | 주요 블록 간격 |
| `--ap-section-gap` | 48px | 큰 섹션 간격 |
| `--ap-touch-target` | 44px | 최소 터치 영역 |
| `--ap-bottom-cta-height` | 88px | bottom CTA 영역 |

### 5.4 Desktop / Editorial Tokens
| Token | Value | Use |
|---|---:|---|
| `--ap-page-margin` | 64px | 데스크톱 기본 좌우 여백 |
| `--ap-page-margin-lg` | 96px | 브랜드/에디토리얼 페이지 |
| `--ap-hero-y` | 128px | 히어로 상하 여백 |
| `--ap-gallery-gap` | 32px | 이미지 그리드 간격 |

---

## 6. Shape & Elevation

### 6.1 Radius
StudioBlank처럼 완전한 0px를 기본화하지 않습니다. Archive Pilates는 프리미엄 웰니스 브랜드이므로 부드러운 radius를 유지합니다.

| Token | Value | Use |
|---|---:|---|
| `--ap-radius-xs` | 6px | 작은 badge, chip |
| `--ap-radius-sm` | 10px | input, small button |
| `--ap-radius-md` | 14px | card, list group |
| `--ap-radius-lg` | 20px | bottom sheet, modal, large media |
| `--ap-radius-full` | 999px | pill, avatar |

### 6.2 Elevation
- 기본은 flat합니다.
- shadow는 floating surface에만 매우 약하게 사용합니다.
- 카드 구분은 shadow보다 border, spacing, background 차이로 해결합니다.

| Token | Value | Use |
|---|---|---|
| `--ap-shadow-none` | `none` | 기본 카드/리스트 |
| `--ap-shadow-soft` | `0 8px 24px rgba(26,26,26,.06)` | floating card |
| `--ap-shadow-modal` | `0 20px 60px rgba(26,26,26,.16)` | dialog, sheet |

---

## 7. Components

### 7.1 Buttons
| Variant | Role | Style |
|---|---|---|
| `fill` | 최종/주요 행동 | `--ap-primary` background, white text |
| `weak` | 선택/보조 강조 | `--ap-primary-weak` background, `--ap-primary` text |
| `outline` | 보조 행동 | border + neutral text |
| `ghost` | 낮은 우선순위 | no fill, neutral text |
| `danger` | 취소/삭제 | `--ap-error` background or text |

Rules:
- 한 화면의 강한 fill CTA는 하나만 둡니다.
- 예약/결제/신청 화면에서는 bottom CTA가 최종 행동을 소유합니다.
- 버튼 문구는 동사형으로 짧게 씁니다.

### 7.2 Cards
Archive cards should feel like quiet containers, not decorative boxes.

| Type | Use | Treatment |
|---|---|---|
| `image-card` | 클래스, 강사, 공간 | image first, caption below |
| `info-card` | 안내, 정책, 요약 | warm/white surface + soft border |
| `action-card` | 다음 행동 유도 | one title, one line, one CTA |
| `status-card` | 예약 상태 | status chip + concise metadata |

Rules:
- 카드 내부에 또 다른 카드를 중첩하지 않습니다.
- 이미지 카드는 fixed ratio를 유지합니다.
- 텍스트 오버레이는 꼭 필요할 때만 사용하고 scrim을 적용합니다.

### 7.3 Inputs & Forms
Verdana Health의 신뢰 UX를 Archive 톤으로 적용합니다.

| State | Border | Background | Helper |
|---|---|---|---|
| Default | `--ap-border` | `--ap-layer` | neutral |
| Focus | `--ap-fg1` 2px | `--ap-layer` | optional |
| Error | `--ap-error` 2px | `--ap-layer` | error text |
| Disabled | `--ap-border-soft` | `--ap-grey-bg` | disabled text |

Rules:
- label은 input 위에 둡니다.
- helper text는 1문장으로 제한합니다.
- 긴 신청서는 section 단위로 나누고 progress를 제공합니다.
- 필수 항목 표시는 과하게 붉게 하지 않습니다.

### 7.4 Chips / Badges
| Type | Use | Style |
|---|---|---|
| Filter chip | 클래스 필터 | neutral default, primary weak selected |
| Status chip | 예약 상태 | status background + status text |
| Meta chip | 난이도/시간/공간 | neutral background |

Rules:
- chip을 과도하게 나열하지 않습니다.
- 5개 이상의 필터는 segmented control 또는 bottom sheet로 이동합니다.
- uppercase English는 제한적으로 사용합니다.

### 7.5 Lists
List row는 예약 플로우의 기본 단위입니다.

| Property | Value |
|---|---:|
| min-height | 56px |
| touch target | 44px 이상 |
| horizontal padding | 20–24px |
| divider | `--ap-border-soft` |
| title | body or headline |
| description | body-sm / fg3 |

Use for:
- 수업 시간 선택
- 강사 선택
- 회원권 선택
- 예약 상세 메타 정보
- 설정/마이페이지 항목

### 7.6 Overlays
| UI | Use | Avoid |
|---|---|---|
| Toast | 저장/완료/일시 오류 | 사용자의 결정이 필요한 상황 |
| Bottom Sheet | 상세 정보, 선택지, 정책 안내 | sheet 안의 sheet |
| Dialog | 취소, 결제, 삭제 등 명시적 결정 | 단순 안내 |

Archive tone:
- 제목은 직접적으로 씁니다.
- 본문은 가능한 한 한 문장입니다.
- destructive action은 색상과 문구 모두 신중하게 사용합니다.

---

## 8. Photography & Art Direction

### 8.1 Image Principle
사진은 Archive Pilates의 가장 중요한 감성 자산입니다.

- soft natural light
- editorial wellness composition
- warm neutral interior
- body line, posture, breath, calm motion
- empty space around subject
- controlled crop
- no over-saturated fitness stock mood

### 8.2 Image Usage
| Context | Direction |
|---|---|
| Home hero | 공간감이 느껴지는 넓은 crop |
| Class card | 동작보다 분위기와 자세의 균형 |
| Instructor | 과한 포즈보다 신뢰감 있는 portrait |
| Booking | 이미지보다 정보 명확성 우선 |
| Campaign | 여백 많은 에디토리얼 구성 |

### 8.3 Don’t
- 땀, 고강도 운동, 헬스장 느낌의 stock photo
- 과하게 밝은 뷰티샵 이미지
- purple/blue gradient overlay
- 텍스트가 사진을 가리는 구성
- AI 이미지 특유의 과한 광택과 비현실적 인체

---

## 9. Mobile Screen Patterns

### 9.1 Default Rhythm
1. Safe area
2. Top area: context + title + short subtitle
3. Calm content blocks or photo-led card
4. List/action group
5. Bottom CTA
6. Toast/sheet/dialog only when needed

### 9.2 Home
- 오늘 가능한 수업 또는 다음 예약을 먼저 보여줍니다.
- 대시보드처럼 많은 수치를 보여주지 않습니다.
- 추천 구성: next class, class category, instructor note, reservation CTA.

### 9.3 Class Discovery
- 이미지 카드는 고정 비율을 사용합니다.
- 필터는 적게, grouping은 명확하게.
- 카드 제목보다 수업 시간/난이도/강사 정보의 읽기 흐름이 우선입니다.

### 9.4 Class Detail
- 상단 이미지 + 핵심 정보 + 예약 CTA.
- 상세 설명, 준비물, 취소 정책은 bottom sheet로 분리합니다.
- 한 화면에 모든 정보를 펼치지 않습니다.

### 9.5 Booking
- 한 번에 하나의 결정만 요구합니다.
- 시간 선택 → 회원권/결제 → 확인의 흐름을 유지합니다.
- 오류는 문장으로 설명하고, 해결 행동을 제공합니다.

### 9.6 Profile / Membership
- 병원 앱처럼 차갑게 보이지 않도록 warm neutral surface를 사용합니다.
- 남은 횟수/만료일은 명확하지만 과도한 차트는 사용하지 않습니다.
- 운영 정보는 list row로 정돈합니다.

---

## 10. Social / Marketing Design Rules

### 10.1 Instagram Feed
- 1080x1350 portrait 우선.
- 한 장에 메시지 하나.
- 사진형과 타이포형을 섞되 톤은 유지합니다.
- CTA는 작고 조용하게 둡니다.

### 10.2 Instagram Story
- 상단 safe area와 하단 UI 영역을 피합니다.
- 예약 유도는 마지막 20% 영역에 배치합니다.
- 배경 이미지는 어둡게 덮기보다 warm overlay를 약하게 사용합니다.

### 10.3 Posters / Notices
- StudioBlank처럼 여백을 충분히 둡니다.
- 정보 위계: 제목 → 핵심 날짜/시간 → 설명 → CTA.
- 장식보다 타이포 정렬과 간격으로 완성도를 만듭니다.

---

## 11. Implementation Tokens

### CSS Token Additions
```css
:root {
  --ap-bg-warm: #FAF8F5;
  --ap-layer-warm: #FFF8F2;
  --ap-border-soft: #F0EFED;
  --ap-fg-disabled: #A8A8A8;

  --ap-success: #2F8F5B;
  --ap-success-bg: #EEF8F1;
  --ap-warning: #B7791F;
  --ap-warning-bg: #FFF7E8;
  --ap-error: #C2412D;
  --ap-error-bg: #FFF0ED;
  --ap-info: #5B6470;
  --ap-info-bg: #F3F4F5;

  --ap-radius-xs: 6px;
  --ap-radius-sm: 10px;
  --ap-radius-md: 14px;
  --ap-radius-lg: 20px;

  --ap-shadow-soft: 0 8px 24px rgba(26,26,26,.06);
  --ap-shadow-modal: 0 20px 60px rgba(26,26,26,.16);
}
```

### Utility Class Suggestions
```css
.ap-editorial-section {
  padding-block: 96px;
  background: var(--ap-bg-warm);
}

.ap-photo-card {
  border-radius: var(--ap-radius-md);
  overflow: hidden;
  background: var(--ap-layer);
  border: 1px solid var(--ap-border-soft);
}

.ap-status-chip {
  min-height: 28px;
  padding: 5px 10px;
  border-radius: var(--ap-radius-full);
  font: var(--ap-caption);
}

.ap-form-group {
  display: grid;
  gap: 8px;
}
```

---

## 12. Quality Checklist

### Brand
- [ ] Archive의 warm neutral + red-orange 정체성이 유지되는가?
- [ ] StudioBlank처럼 충분한 여백과 절제가 있는가?
- [ ] Verdana Health처럼 사용자가 신뢰할 수 있는 구조인가?
- [ ] 병원 앱, 헬스장 앱, 뷰티샵 템플릿처럼 보이지 않는가?

### UI
- [ ] 최종 CTA가 명확한가?
- [ ] 한 화면에 너무 많은 카드/칩이 없는가?
- [ ] 텍스트가 모바일에서 읽기 쉬운가?
- [ ] 터치 영역이 44px 이상인가?
- [ ] 상태 색상이 기능적으로만 쓰였는가?

### Content
- [ ] 카피가 짧고 정중한 한국어인가?
- [ ] 과장된 마케팅 문구가 없는가?
- [ ] 오류/안내 문구가 해결 행동을 포함하는가?

### Visual
- [ ] 사진이 UI보다 먼저 호흡하는가?
- [ ] shadow와 decoration이 과하지 않은가?
- [ ] 레드오렌지 사용량이 절제되어 있는가?

---

## 13. File Role

This file is the **v1.2 conceptual and practical direction layer**.  
It should be used alongside:

- `README.md`
- `아카이브필라테스 디자인 시스템.md`
- `AP_MOBILE_TDS_PLAYBOOK.md`
- `colors_and_type.css`
- `css/colors.css`

When future design work needs a judgment call, use this order:

1. Archive Pilates brand identity
2. v1.2 reference blend principles
3. v1.1 mobile/TDS component rules
4. Specific production constraints

---

## 14. Summary

Archive Pilates v1.2 is not a new visual identity.  
It is a refinement layer that makes the existing identity more premium, more editorial, and more trustworthy.

- StudioBlank gives Archive more silence.
- Verdana Health gives Archive more trust.
- Archive Pilates keeps its own warmth, rhythm, and red-orange signature.
