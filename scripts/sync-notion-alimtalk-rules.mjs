#!/usr/bin/env node
import process from "node:process";

const NOTION_VERSION = "2022-06-28";
const DEFAULT_PARENT_PAGE_ID = "361d49eae4bf8189adf5f7effcdf5bfd";
const DEFAULT_CHILD_TITLE = "카카오 알림톡 템플릿 분류와 SOLAPI 네이밍 규칙";

const token = process.env.NOTION_TOKEN || "";
const parentPageId = compactId(process.env.NOTION_ALIMTALK_PARENT_PAGE_ID || DEFAULT_PARENT_PAGE_ID);
const childPageId = process.env.NOTION_ALIMTALK_TEMPLATE_PAGE_ID
  ? compactId(process.env.NOTION_ALIMTALK_TEMPLATE_PAGE_ID)
  : "";
const childTitle = process.env.NOTION_ALIMTALK_TEMPLATE_PAGE_TITLE || DEFAULT_CHILD_TITLE;

if (process.argv.includes("--help")) {
  console.log(`Usage:
  NOTION_TOKEN=secret_... node scripts/sync-notion-alimtalk-rules.mjs

Optional env:
  NOTION_ALIMTALK_PARENT_PAGE_ID=${DEFAULT_PARENT_PAGE_ID}
  NOTION_ALIMTALK_TEMPLATE_PAGE_ID=<existing child page id>
  NOTION_ALIMTALK_TEMPLATE_PAGE_TITLE="${DEFAULT_CHILD_TITLE}"
`);
  process.exit(0);
}

if (!token) {
  console.error("Missing NOTION_TOKEN. Create a Notion internal integration token and share the target page with it.");
  process.exit(2);
}

const pageId = childPageId || (await findOrCreateChildPage());
await replaceChildren(pageId, buildBlocks());
console.log(`Updated Notion page: ${pageId}`);

async function findOrCreateChildPage() {
  const search = await notion("/search", {
    method: "POST",
    body: {
      query: childTitle,
      filter: { value: "page", property: "object" },
      page_size: 10,
    },
  });
  const existing = (search.results || []).find((page) => plainTitle(page) === childTitle);
  if (existing?.id) return compactId(existing.id);

  const page = await notion("/pages", {
    method: "POST",
    body: {
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ text: { content: childTitle } }],
        },
      },
      children: [],
    },
  });
  return compactId(page.id);
}

async function replaceChildren(pageId, blocks) {
  for await (const block of childBlocks(pageId)) {
    await notion(`/blocks/${block.id}`, {
      method: "PATCH",
      body: { archived: true },
    });
  }
  for (const chunk of chunks(blocks, 80)) {
    await notion(`/blocks/${pageId}/children`, {
      method: "PATCH",
      body: { children: chunk },
    });
  }
}

async function* childBlocks(pageId) {
  let cursor = "";
  do {
    const query = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : "";
    const res = await notion(`/blocks/${pageId}/children${query}`);
    for (const block of res.results || []) yield block;
    cursor = res.has_more ? res.next_cursor : "";
  } while (cursor);
}

function buildBlocks() {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  return [
    heading(2, "운영 기준"),
    paragraph(`마지막 동기화: ${today}`),
    paragraph("ARCHIVE IN 알림톡 템플릿은 채널과 수신자 성격에 따라 회원용, 스텝/담당강사용, 강사레슨 회원용으로 분리한다."),
    heading(2, "분류"),
    bullet("회원용: ARCHIVE PILATES 일반 회원 채널. prefix는 `회원용_`. 신규회원, 수강권, 프라이빗/그룹 사전설문 요청을 포함한다."),
    bullet("스텝/담당강사용: ARCHIVE PILATES 내부 운영/강사용. prefix는 `강사용_`. 설문 제출 후 담당강사 확인 알림을 포함한다."),
    bullet("강사레슨 회원용: 아카이브강사레슨 채널. prefix는 `강사레슨_`. 강사레슨 수업자료 안내를 포함한다."),
    heading(2, "SOLAPI 템플릿 네이밍"),
    bullet("회원용_신규회원 웰컴 안내 v3"),
    bullet("회원용_프라이빗 사전설문 안내 v1"),
    bullet("회원용_그룹 첫 수업 사전확인 안내 v1"),
    bullet("회원용_장기 미방문 수업안내 v1: Template ID `KA01TP260524083643752cySb9BoDOjN`, 현재 `APPROVED`. 매일 11:30 자동 발송 대상에 포함한다."),
    bullet("강사용_프라이빗 사전설문 제출 안내 v1"),
    bullet("강사용_그룹 사전확인 제출 안내 v1"),
    bullet("강사레슨_수업자료 안내 v1: 아카이브강사레슨 채널, Template ID `KA01TP260521120040094XcMvYgFTryj`, 현재 `INSPECTING`. 수업자료/방문안내 버튼 2개 구성이다."),
    heading(2, "자동화 규칙"),
    bullet("SOLAPI 템플릿 승인 상태는 매일 10:00 및 11:30 발송 직전에 자동 동기화한다."),
    bullet("발송 실패 재시도는 1회만 허용한다. 최초 실패와 재시도 실패 후에는 자동/수동 큐 전환을 막는다."),
    bullet("예약오픈 안내는 월요일에만 자동 후보를 만들며, 활성 그룹 수강권 보유 회원만 대상으로 한다. 예약주차는 다음 주 월~일로 자동 계산한다. 실제 큐 전환은 예약 시작 오픈 30분 전인 월요일 12:30 KST 전용 스케줄에서만 수행한다. 예: 2026-05-25 기준 `6월1주차(6/1(월)~6/7(일))`."),
    bullet("예약오픈 안내 후보 생성과 stale 스킵은 11:30 일일 알림톡 루틴과 분리한다. 11:30 루틴은 예약오픈 후보를 만들거나 스킵하지 않고, 12:30 루틴은 예약오픈 후보만 만들고 다른 템플릿 후보 상태를 건드리지 않는다."),
    bullet("예약오픈 안내의 수강권 기간 판정은 발송일이 아니라 예약주차와의 겹침 여부로 본다. 예: 2026-05-25 발송은 2026-06-01~2026-06-07 사이 이용 가능한 그룹권을 포함하고, 2026-06-08 이후 시작 수강권만 보유한 회원은 제외한다."),
    bullet("수강권 기간/횟수 알림의 중복 방지는 회원, 템플릿, 수강권 식별자를 함께 사용한다. 같은 이름의 새 수강권은 별도 대상이다."),
    bullet("장기 미방문 안내는 활성 수업 수강권 보유, 마지막 출석 10일 이상, 수강권 정지/중지/홀딩 아님, 발송 기준일 당일 또는 이후 예정 예약 없음 조건으로 후보를 만든다. 중복 방지는 회원별 14일이다."),
    bullet("StudioMate 엑셀의 `수강권상태`가 정지중/중지/홀딩이면 `memberProfiles.ticketStatusSummary.hasHoldingTicket`으로 저장하고 장기 미방문 안내에서 제외한다."),
    bullet("프라이빗/그룹 설문은 마지막 같은 유형 설문 제출 후 1년이 지나면 다시 후보가 될 수 있다."),
    bullet("강사용 그룹 설문 알림은 수업 1시간 전 이후, 강사용 프라이빗 설문 알림은 수업 하루 전 오전 9시 이후 발송한다."),
    bullet("강사레슨 수업자료 안내는 수업 하루 전 발송을 기본으로 하며, 버튼은 `수업자료 보기`와 `방문안내 보기` 2개를 사용한다."),
    bullet("설문/수업자료 버튼은 함수가 `shortLinks/{링크ID}`를 만들고 SOLAPI에는 `https://in.archivepilates.com/s/#{링크ID}/` 형식의 100자 이하 짧은 링크를 넣는다."),
    bullet("현재 승인 템플릿이 기존 `설문ID`, `접근토큰`, `관리번호` 버튼을 쓰는 동안에는 원본 URL과 짧은 URL을 모두 검사한다."),
    bullet("강사레슨 수업자료 원본 URL은 `https://in.archivepilates.com/method/#{관리번호}`, 방문안내 버튼 URL은 `https://www.notion.so/367d49eae4bf811ca3daea273ed278c8`이다."),
    heading(2, "Repo 원본"),
    paragraph("상세 원본은 GitHub repo의 `docs/solapi-template-data-operating-rules.md`, `docs/kakao-alimtalk-automation-handoff.md`, `docs/archivein-member-contact-alimtalk-pipeline.md`를 기준으로 한다."),
  ];
}

async function notion(path, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || `Notion API ${response.status}`);
  }
  return body;
}

function plainTitle(page) {
  const title = Object.values(page.properties || {}).find((property) => property?.type === "title");
  return (title?.title || []).map((item) => item?.plain_text || item?.text?.content || "").join("");
}

function heading(level, content) {
  return {
    object: "block",
    type: `heading_${level}`,
    [`heading_${level}`]: rich(content),
  };
}

function paragraph(content) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: rich(content),
  };
}

function bullet(content) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: rich(content),
  };
}

function rich(content) {
  return {
    rich_text: [{ type: "text", text: { content } }],
  };
}

function compactId(value) {
  return String(value || "").replace(/-/g, "");
}

function chunks(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}
