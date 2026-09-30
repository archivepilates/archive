export const implementationLabels = Object.freeze({
  source_connected: "소스 연결",
  source_only: "소스 전용",
  unconnected: "미연결",
  archived: "종료·이력",
  separate_project: "별도 프로젝트",
});

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const list = (items) => `<ul>${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`;

export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(catalog.policyFingerprint) || !Array.isArray(catalog.rows) || !catalog.rows.length)
    throw new Error("카탈로그 형식 확인 필요");
  const ids = new Set();
  for (const row of catalog.rows) {
    if (!row.id || ids.has(row.id) || !row.label || !row.purpose || !row.timing || !implementationLabels[row.implementation] || !Array.isArray(row.targetRules) || !row.targetRules.length || !Array.isArray(row.sources) || !row.sources.length)
      throw new Error("템플릿 정책 연결 확인 필요");
    ids.add(row.id);
    // A generated source file is never fresh provider or deployment evidence.
    if (row.providerApproval?.status !== "UNKNOWN" || row.providerApproval.checkedAt !== null || row.deployment?.status !== "UNVERIFIED")
      throw new Error("소스 자료에 운영 상태가 혼합되어 있습니다");
  }
  if (catalog.rows.filter((row) => row.knownProvider).length !== catalog.coverage?.knownProviderCount)
    throw new Error("공급자 목록 대조 필요");
  return catalog;
}

export function selectCatalogRows(catalog, { search = "", scope = "all", implementation = "all" } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return catalog.rows.filter((row) => {
    if (scope === "known" && !row.knownProvider) return false;
    if (scope === "source" && row.knownProvider) return false;
    if (implementation !== "all" && row.implementation !== implementation) return false;
    const text = [row.label, row.providerInventoryName, row.code, row.type, row.purpose, row.timing, ...row.targetRules].join(" ").toLocaleLowerCase();
    return !query || text.includes(query);
  });
}

export function scheduleText(schedule) {
  if (!schedule) return "별도 정시 스케줄 없음";
  const known = { "30 11 * * *": "매일 11:30", "30 12 * * 1": "월요일 12:30", "every 10 minutes": "10분 주기", "0 7-21 * * *": "매일 07:00~21:00 정각" };
  return `${known[schedule.expression] || schedule.expression} · ${schedule.timezone}`;
}

export function renderCatalogRow(row) {
  const fact = row.factNotice;
  const status = implementationLabels[row.implementation];
  const exclusions = row.policy?.exclusionRules || [];
  return `<details class="catalog-row" data-testid="catalog-row" data-catalog-id="${escape(row.id)}">
    <summary aria-label="${escape(row.label)} 정책 상세">
      <span class="catalog-name"><strong>${escape(row.label)}</strong><small>${row.knownProvider ? "확인된 SOLAPI 목록" : "소스·이력 추가"}${fact ? " · 사실 안내" : ""}</small></span>
      <span class="catalog-cell"><small>목적</small>${escape(row.purpose)}</span>
      <span class="catalog-cell"><small>시기</small>${escape(row.timing)}${row.schedule ? `<span class="catalog-muted">${escape(scheduleText(row.schedule))}</span>` : ""}</span>
      <span class="catalog-cell"><small>대상</small>${escape(row.targetRules[0])}${fact ? `<span class="catalog-muted">${escape(fact.targetRule)}</span>` : ""}</span>
      <span class="catalog-cell catalog-status"><small>구현 · 공급자 승인</small><span class="catalog-state" data-state="${escape(row.implementation)}">${escape(status)}</span><span class="catalog-muted">승인 미확인</span></span>
    </summary>
    <div class="catalog-detail">
      <section><h3>대상·제외 조건</h3>${list(row.targetRules)}${exclusions.length ? `<h4>제외</h4>${list(exclusions)}` : "<p>별도 중앙 제외 정책 미연결</p>"}</section>
      <section><h3>정책 구분</h3><dl>
        <dt>시기</dt><dd>${escape(row.timing)}<br>${escape(scheduleText(row.schedule))}</dd>
        <dt>날짜 조건</dt><dd>${escape(row.policy?.sourceDatePolicy || "미연결")}${row.policy?.minSourceDate ? ` · 시작 ${escape(row.policy.minSourceDate)}` : ""}${row.policy?.maxAgeDays != null ? ` · ${escape(row.policy.maxAgeDays)}일 이내` : ""}</dd>
        <dt>회원관리 알림</dt><dd>${row.careGroup ? "회원관리 중복 정책 적용 · 소스 기준" : "회원관리 교차제한 대상 아님"}</dd>
        <dt>운영 승인</dt><dd>개별·배치 승인은 별도 절차. 이 목록은 승인·발송 권한을 부여하지 않습니다.</dd>
        <dt>공급자 승인</dt><dd>미확인 · 최신 승인 상태 미조회</dd>
        <dt>배포·실발송</dt><dd>미검증 · 소스 연결은 운영 가동 증거가 아닙니다.</dd>
      </dl>${fact ? `<h4>사실 안내 원문 검토</h4><p>${escape(fact.reviewedAt)} 소스 계약 검토 완료. 후속권 보유만으로 사실 안내 후보를 제외하지 않습니다. 현재 네 템플릿은 재심사 대상이 아닙니다.</p><p>알 수 없거나 본문·버튼이 변경된 템플릿만 검토 대기합니다. 발송 직전 원문 검증과 운영 승인은 별도입니다.</p><code>${escape(fact.contractFingerprint)}</code>` : ""}</section>
      <section class="catalog-source"><h3>소스 근거</h3><dl><dt>유형</dt><dd><code>${escape(row.type || "중앙 유형 없음")}</code></dd><dt>공급자 코드</dt><dd><code>${escape(row.code || "삭제된 소스 항목 · 코드 없음")}</code></dd><dt>소스 설정값</dt><dd>${escape(row.sourceConfiguredStatus || "없음")} · 공급자 현재 상태 아님</dd></dl>
      ${row.providerInventoryName && row.providerInventoryName !== row.label ? `<p>확인된 SOLAPI 이름: ${escape(row.providerInventoryName)}</p>` : ""}
      <ul>${row.sources.map((ref) => `<li><code>${escape(ref.path)}:${escape(ref.line)}<br>${escape(ref.symbol)}</code></li>`).join("")}</ul>
      ${row.policy?.buttonUrlRules?.length ? `<h4>버튼 계약</h4>${list(row.policy.buttonUrlRules.map((button) => `${button.label} · ${button.template} · 최대 ${button.maxLength}자`))}` : ""}</section>
    </div>
  </details>`;
}

export async function mountTemplateCatalog(host, { url = new URL("./alimtalk-catalog.json", import.meta.url), fetcher = fetch } = {}) {
  host.innerHTML = `<div class="catalog-heading"><div><h2 id="catalogTitle">템플릿 카탈로그</h2></div><a href="../rules/#alimtalk-catalog-draft">운영규칙</a></div>
    <div class="catalog-load" role="status">정책 자료 읽는 중</div>`;
  host.setAttribute("aria-busy", "true");
  try {
    const response = await fetcher(url, { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error(`정책 자료 응답 ${response.status}`);
    const catalog = validateCatalog(await response.json());
    host.querySelector(".catalog-load").remove();
    host.insertAdjacentHTML("beforeend", `<div class="catalog-provenance"><p>확인된 SOLAPI ${catalog.coverage.knownProviderCount}종 + 소스·이력 ${catalog.rows.length - catalog.coverage.knownProviderCount}종</p><details><summary>소스 기준 · 정책 버전·근거</summary><p>목록 기준 ${escape(catalog.coverage.observedAt)}. 최신 공급자 승인·운영 환경변수·실제 배포·최근 발송은 미확인입니다.</p><code>${escape(catalog.policyFingerprint)}</code><a href="${escape(String(url))}" download="alimtalk-catalog.json">정책 데이터 내려받기</a></details></div>
      <div class="catalog-filters"><label>템플릿 검색<input type="search" name="catalog-search" autocomplete="off" placeholder="이름, 목적, 대상, 코드"></label><label>목록 범위<select name="catalog-scope"><option value="all">전체</option><option value="known">확인된 SOLAPI 23종</option><option value="source">소스·이력 추가</option></select></label><label>구현 상태<select name="catalog-implementation"><option value="all">전체 상태</option>${Object.entries(implementationLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label></div>
      <p class="catalog-count" role="status" aria-live="polite"></p><div class="catalog-results"></div>`);
    const search = host.querySelector('[name="catalog-search"]');
    const scope = host.querySelector('[name="catalog-scope"]');
    const implementation = host.querySelector('[name="catalog-implementation"]');
    const render = () => {
      const rows = selectCatalogRows(catalog, { search: search.value, scope: scope.value, implementation: implementation.value });
      host.querySelector(".catalog-count").textContent = `${rows.length} / ${catalog.rows.length}종`;
      host.querySelector(".catalog-results").innerHTML = rows.length ? rows.map(renderCatalogRow).join("") : '<p class="catalog-empty">일치하는 템플릿이 없습니다.</p>';
    };
    search.addEventListener("input", render);
    scope.addEventListener("change", render);
    implementation.addEventListener("change", render);
    render();
    host.dataset.catalogState = "ready";
  } catch (error) {
    host.dataset.catalogState = "error";
    host.querySelector(".catalog-load")?.remove();
    host.querySelector(".catalog-results")?.remove();
    host.insertAdjacentHTML("beforeend", `<div class="catalog-load" role="status"><p>카탈로그 확인 필요 · 목록을 읽지 못했습니다. 0종으로 판단하지 않습니다.</p><button type="button">다시 읽기</button></div>`);
    host.querySelector("button").addEventListener("click", () => mountTemplateCatalog(host, { url, fetcher }));
  } finally {
    host.setAttribute("aria-busy", "false");
  }
}
