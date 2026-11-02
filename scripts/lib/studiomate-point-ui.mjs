import { phone, samePointState } from "./studiomate-referral-points.mjs";

export function parsePointSummary(text) {
  const value = (label, usage = false) => {
    const match = text.match(new RegExp(`${label}\\s*(-?[\\d,]+)\\s*P`));
    if (!match) throw new Error("point_summary_not_loaded");
    // StudioMate renders cumulative usage as a negative amount. Normalize only
    // that counter to a positive magnitude; never reinterpret a negative balance.
    const raw = Number(match[1].replaceAll(",", ""));
    const n = usage ? Math.abs(raw) : raw;
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("invalid_point_balance");
    return n;
  };
  return { remaining: value("잔여 포인트"), earned: value("적립 포인트"), used: value("사용 포인트", true) };
}

export function createStudioMatePointUI(page) {
  let lastFresh, lastFreshAt = 0;
  const summary = () => page.getByText("포인트 합계", { exact: true });
  async function identity(target) {
    if (new URL(page.url()).origin !== "https://arcpilates.studiomate.kr" ||
        new URL(page.url()).pathname !== "/users/detail" ||
        new URL(page.url()).searchParams.get("id") !== target.memberId)
      throw new Error("point_member_url_mismatch");
    const names = await page.locator("h3").allTextContents();
    if (names.filter(name => name.trim() === target.name).length !== 1)
      throw new Error("point_member_name_mismatch");
    const label = page.locator("label").filter({ hasText: /^휴대폰번호:/ });
    if (await label.count() !== 1) throw new Error("point_phone_label_unverified");
    const text = await label.evaluate(e => e.parentElement.innerText);
    const matches = text.match(/010[-\s]?\d{4}[-\s]?\d{4}/g) || [];
    if (matches.length !== 1 || phone(matches[0]) !== phone(target.phone)) throw new Error("point_member_phone_mismatch");
  }
  async function readCurrent(target) {
    await identity(target);
    const text = await summary().evaluate(e => e.parentElement.parentElement.innerText);
    const rows = await page.locator(".el-table__body-wrapper tr").allTextContents();
    return { memberId: target.memberId, name: target.name, phone: phone(target.phone), ...parsePointSummary(text),
      history: rows.map(text => ({ reason: text.replaceAll(/\s+/g, " ").trim() })) };
  }
  async function independentRead(target) {
    const peer = await page.context().newPage();
    try {
      lastFresh = await createStudioMatePointUI(peer).read(target);
      lastFreshAt = Date.now();
      return lastFresh;
    } finally { await peer.close(); }
  }
  return {
    async read(target) {
      await page.goto(`https://arcpilates.studiomate.kr/users/detail?id=${target.memberId}`, { waitUntil: "domcontentloaded" });
      await page.getByText("포인트 내역", { exact: true }).click();
      await summary().waitFor({ state: "visible" });
      // Initial zero placeholders are not a balance. Require the SPA's requests
      // to settle, its loading masks to disappear and two equal DOM readbacks.
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      for (const mask of await page.locator(".el-loading-mask:visible").all())
        await mask.waitFor({ state: "hidden", timeout: 15_000 });
      const first = await readCurrent(target);
      await page.waitForTimeout(600);
      const second = await readCurrent(target);
      if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("point_readback_unstable");
      return second;
    },
    readCurrent: independentRead,
    async prepare(target, action) {
      await identity(target);
      await page.getByRole("button", { name: "포인트 수정", exact: true }).filter({ visible: true }).click();
      const dialog = page.locator(".point-edit-dialog:visible");
      if (await dialog.count() !== 1) throw new Error("point_dialog_unverified");
      const radio = dialog.locator(`input[type=radio][value=${action.direction === "credit" ? "reward" : "deduct"}]`);
      await radio.locator("..").click();
      const fields = dialog.locator("input[type=text]");
      if (await fields.count() !== 3) throw new Error("point_form_shape_changed");
      await fields.nth(action.direction === "credit" ? 0 : 1).fill(String(action.points));
      await dialog.getByPlaceholder("최대 20자까지 입력", { exact: true }).fill(action.reason);
      // Native first-stage '수정' opens a separate confirmation; it does not save.
      await dialog.getByRole("button", { name: "수정", exact: true }).click();
      await page.locator(".point-edit-final-check-dialog:visible").waitFor();
    },
    async confirm(target, action, beforeFinalConfirm) {
      await identity(target);
      const dialog = page.locator(".point-edit-dialog:visible");
      const direction = action.direction === "credit" ? "reward" : "deduct";
      if (!await dialog.locator(`input[type=radio][value=${direction}]`).isChecked() ||
          (await dialog.locator("input[type=text]").nth(action.direction === "credit" ? 0 : 1).inputValue()).replaceAll(",", "") !== String(action.points) ||
          await dialog.getByPlaceholder("최대 20자까지 입력", { exact: true }).inputValue() !== action.reason)
        throw new Error("point_form_binding_changed");
      const cached = await readCurrent(target);
      const current = Date.now() - lastFreshAt <= 1500 && lastFresh ? lastFresh : await independentRead(target);
      if (!samePointState(cached, current)) throw new Error("native_points_changed_while_dialog_open");
      const final = page.locator(".point-edit-final-check-dialog:visible");
      if (await final.count() !== 1) throw new Error("point_final_confirmation_missing");
      const text = (await final.innerText()).replace(/[,\s]/g, "");
      const label = action.direction === "credit" ? "적립" : "차감";
      const expected = current.remaining + (action.direction === "credit" ? action.points : -action.points);
      const signed = action.direction === "credit" ? String(action.points) : `-${action.points}`;
      if (!text.includes(`${label}${signed}P`) || !text.includes(`${label}후잔여포인트${expected}P`))
        throw new Error("point_final_confirmation_amount_mismatch");
      if (typeof beforeFinalConfirm !== "function") throw new Error("point_final_gate_required");
      // Run source/config/claim checks after slow independent browser reads, as
      // the last business gate before the actual native save button.
      await beforeFinalConfirm();
      await final.getByRole("button", { name: "확인", exact: true }).click();
      await page.locator(".point-edit-final-check-dialog").waitFor({ state: "hidden", timeout: 15_000 });
      await page.locator(".point-edit-dialog").waitFor({ state: "hidden", timeout: 15_000 });
    },
    async cancel() {
      const final = page.locator(".point-edit-final-check-dialog:visible");
      if (await final.count()) await final.getByRole("button", { name: "취소", exact: true }).click();
      const dialog = page.locator(".point-edit-dialog:visible");
      if (await dialog.count()) await dialog.getByRole("button", { name: "취소", exact: true }).click();
    },
  };
}
