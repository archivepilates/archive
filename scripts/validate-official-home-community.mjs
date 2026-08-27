import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const communityUrl = "https://archivepilates.imweb.me/community";
const htmlFiles = [
  "official-home/index.html",
  "official-home/teams/index.html",
  "official-home/teams/kihyo/index.html",
  "official-home/teams/minjin/index.html",
  "official-home/teams/eunyoung/index.html",
  "official-home/teams/chorim/index.html",
];
const teamHtmlFiles = htmlFiles.filter((relativePath) => relativePath !== "official-home/index.html");

const failures = [];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

for (const relativePath of htmlFiles) {
  const html = read(relativePath);
  if (!html.includes('href="/community"')) {
    failures.push(`${relativePath}: 커뮤니티 메뉴 링크가 없습니다.`);
  }
  if (!html.includes('data-nav="community"')) {
    failures.push(`${relativePath}: COMMUNITY 메뉴 식별자가 없습니다.`);
  }
}

for (const relativePath of teamHtmlFiles) {
  const html = read(relativePath);
  if (!html.includes('/assets/community-nav-20260827a.css')) {
    failures.push(`${relativePath}: 버전 처리된 COMMUNITY 메뉴 스타일이 없습니다.`);
  }
}

const communityPage = read("official-home/community/index.html");
for (const required of [
  "커뮤니티 | 아카이브필라테스",
  '<span class="nav-ko">커뮤니티</span>',
  "강사레슨 후기",
  "영상 클래스 후기",
  "수업·동작 질문",
  "글 작성은 아카이브 회원",
  communityUrl,
]) {
  if (!communityPage.includes(required)) {
    failures.push(`official-home/community/index.html: 필수 문구 또는 링크 누락: ${required}`);
  }
}

if (!communityPage.includes('/assets/community-nav-20260827a.css')) {
  failures.push("official-home/community/index.html: 버전 처리된 COMMUNITY 메뉴 스타일이 없습니다.");
}
if (!communityPage.includes('/assets/community-20260827b.css')) {
  failures.push("official-home/community/index.html: 버전 처리된 COMMUNITY 페이지 스타일이 없습니다.");
}

for (const removed of ["BEFORE WRITING", "개인정보는 남기지 않습니다.", "community-rules"]) {
  if (communityPage.includes(removed)) {
    failures.push(`official-home/community/index.html: 제거 대상 안내 섹션이 남아 있습니다: ${removed}`);
  }
}

const sitemap = read("official-home/sitemap.xml");
if (!sitemap.includes("https://archivepilates.com/community")) {
  failures.push("official-home/sitemap.xml: community URL이 없습니다.");
}

const firebaseConfig = JSON.parse(read("firebase.archive-home.json"));
const hosting = firebaseConfig.hosting;
const communityRewrite = hosting.rewrites?.find(
  (rule) => rule.source === "/community" && rule.destination === "/community/index.html",
);
if (!communityRewrite) {
  failures.push("firebase.archive-home.json: /community rewrite가 없습니다.");
}

const communityHeader = hosting.headers?.find((rule) => rule.source === "/community");
if (!communityHeader) {
  failures.push("firebase.archive-home.json: /community 캐시 정책이 없습니다.");
}

for (const relativePath of [
  "official-home/assets/community-nav-20260827a.css",
  "official-home/assets/community-20260827b.css",
]) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    failures.push(`${relativePath}: 파일이 없습니다.`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("ARCHIVE PILATES 커뮤니티 공식홈 구성이 유효합니다.");
