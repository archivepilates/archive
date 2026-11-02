const MAINTENANCE_START = Date.parse("2026-11-17T05:00:00.000Z");
const MAINTENANCE_END = Date.parse("2026-11-17T07:00:00.000Z");
const GUIDE_TITLE = "회원 등록 완료 및 이용권 등록 안내";

export function assertStudioMateRegistrationAvailable(now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("StudioMate registration clock unavailable");
  if (now >= MAINTENANCE_START && now < MAINTENANCE_END) {
    const error = new Error("StudioMate 회원등록 개편 점검시간으로 회원 생성·수강권 발급을 보류합니다.");
    error.code = "STUDIOMATE_REGISTRATION_MAINTENANCE";
    error.nextAllowedAt = new Date(MAINTENANCE_END).toISOString();
    throw error;
  }
}

export async function assertNewMemberForm(page, { baseUrl, memberName, memberPhone }) {
  const url = new URL(page.url());
  if (url.origin !== new URL(baseUrl).origin || url.pathname !== "/users/create" || url.search) {
    throw new Error("Unexpected StudioMate new-member form (edit pages are not registration)");
  }
  const names = page.locator('input[placeholder="이름을 입력해주세요"]');
  const phones = page.locator('input[placeholder="휴대폰 번호"]');
  const save = page.getByRole("button", { name: "회원 등록 완료", exact: true });
  if (await names.count() !== 1 || await phones.count() !== 1 || await save.count() !== 1
      || !await save.isEnabled()
      || (await names.inputValue()).trim() !== memberName
      || (await phones.inputValue()).replace(/\D/g, "") !== memberPhone) {
    throw new Error("StudioMate registration form identity or controls changed");
  }
}

export function classifyMemberSave(snapshot, baseUrl) {
  const url = new URL(snapshot.url);
  if (url.origin !== new URL(baseUrl).origin) throw new Error("StudioMate member save changed origin");
  const memberId = url.pathname === "/users/detail" && /^[1-9]\d{0,63}$/.test(url.searchParams.get("id") || "")
    && url.searchParams.getAll("id").length === 1 ? url.searchParams.get("id") : null;
  const dialogs = snapshot.dialogs || [];
  if (dialogs.length) {
    const dialog = dialogs[0];
    const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
    if (dialogs.length !== 1 || normalize(dialog.title) !== GUIDE_TITLE
        || !normalize(dialog.text).includes("회원 등록이 완료되었습니다.")
        || !normalize(dialog.text).includes("수강권")
        || dialog.buttons.filter(value => normalize(value) === "확인").length !== 1
        || dialog.buttons.filter(value => normalize(value) === "취소").length !== 1
        || !["/users/create", "/users/detail"].includes(url.pathname)
        || (url.pathname === "/users/detail" && !memberId)
        || (url.pathname === "/users/create" && url.search)) {
      throw new Error("Unknown StudioMate registration dialog; no continuation or replay allowed");
    }
  }
  if (!memberId && !dialogs.length) throw new Error("StudioMate member save has no persistence signal");
  return { layout: dialogs.length ? "split_registration_ticket_guide" : "legacy_detail", memberId };
}

// Observe only. In particular, never accept the optional ticket-issuance guide.
export async function observeMemberSave(page, baseUrl) {
  const handle = await page.waitForFunction(() => {
    const visible = element => Boolean(element.getClientRects().length)
      && getComputedStyle(element).visibility !== "hidden";
    const nodes = [...document.querySelectorAll('[role="dialog"], .el-dialog, .el-message-box')]
      .filter(visible);
    const roots = nodes.filter(node => !nodes.some(other => other !== node && other.contains(node)));
    const dialogs = roots.map(node => ({
      title: node.querySelector('.el-dialog__title, .el-message-box__title, [data-dialog-title]')?.textContent || "",
      text: node.innerText,
      buttons: [...node.querySelectorAll("button")].filter(visible).map(button => button.innerText),
    }));
    if (!dialogs.length && !/\/users\/detail\?/.test(location.href)) return false;
    return { url: location.href, dialogs };
  }, undefined, { timeout: 30000, polling: 200 });
  try { return classifyMemberSave(await handle.jsonValue(), baseUrl); }
  finally { await handle.dispose(); }
}
