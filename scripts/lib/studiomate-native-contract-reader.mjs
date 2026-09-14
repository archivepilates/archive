// DOM selectors verified read-only in StudioMate on 2026-09-14. No page state or API access.
export function extractNativeContractDom() {
  const fields = [...document.querySelectorAll(".contract-form-field")];
  const value = (label) => {
    const matches = fields.filter(
      (field) => field.firstElementChild?.textContent?.trim() === label,
    );
    if (matches.length !== 1) return null;
    const inputs = matches[0].querySelectorAll("input:not([type=checkbox])");
    return inputs.length === 1 ? inputs[0].value : null;
  };
  const signature = (label) => {
    const matches = [
      ...document.querySelectorAll(
        ".contract-template-footer-signature-block__pad-wrapper li",
      ),
    ].filter(
      (item) => item.querySelector("span")?.textContent?.trim() === label,
    );
    if (matches.length !== 1) return false;
    const images = matches[0].querySelectorAll("img");
    return (
      images.length === 1 &&
      images[0].complete &&
      images[0].naturalWidth > 0 &&
      !!images[0].getAttribute("src")
    );
  };
  const single = (selector, prop = "textContent") => {
    const nodes = document.querySelectorAll(selector);
    return nodes.length === 1 ? String(nodes[0][prop] || "").trim() : null;
  };
  return {
    contractId: new URL(location.href).searchParams.get("id"),
    title: single(".contract-template-form-title__input input", "value"),
    memberName: single(".contract-form-field.name input", "value"),
    memberPhone: single(".contract-form-field.mobile input", "value"),
    statusText: single(".contract-status-tag"),
    signedDateText: single("p.sign-completed-date"),
    memberSignaturePresent: signature("[서명자]"),
    centerSignaturePresent: signature("[아카이브필라테스]"),
    fields: {
      paidAmount: value("결제금액*"),
      outstandingAmount: value("미수금"),
      availableFrom: value("이용시작일*"),
      expiresAt: value("이용종료일*"),
      totalCount: value("전체 횟수*"),
    },
  };
}

export async function readNativeContractPage(page, contractId) {
  if (!/^[a-f0-9]{64}$/.test(contractId))
    throw new Error("Invalid native contract ID");
  const url = `https://arcpilates.studiomate.kr/users/contract/detail?id=${contractId}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Initial skeleton falsely says draft. Require populated title and phone before reading.
  await page.waitForFunction(
    () => {
      const title = document.querySelector(
        ".contract-template-form-title__input input",
      );
      const phone = document.querySelector(".contract-form-field.mobile input");
      return Boolean(title?.value && phone?.value);
    },
    null,
    { timeout: 20_000 },
  );
  if (page.url() !== url)
    throw new Error("Native contract navigation mismatch");
  const observation = await page.evaluate(extractNativeContractDom);
  if (
    observation.contractId !== contractId ||
    !observation.title ||
    !observation.memberPhone
  )
    throw new Error("Incomplete native contract page");
  return { ...observation, observedAt: new Date().toISOString() };
}
