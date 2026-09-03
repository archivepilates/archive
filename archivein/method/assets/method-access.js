(() => {
  "use strict";

  const OPEN_TIME_SUFFIX = "T12:00:00+09:00";
  const OPEN_MESSAGE = "수업자료는 수업 당일 12시에 공개됩니다.";
  const body = document.body;
  const gate = document.querySelector("[data-method-gate]");
  const content = document.querySelector("[data-method-content]");
  const message = gate?.querySelector("[data-method-gate-message]");
  const lessonDate = body.dataset.methodDate || "";
  const previewCode = body.dataset.methodPreviewCode || "";
  const requestedPreview = new URLSearchParams(window.location.search).get("preview") || "";
  const openAt = /^\d{4}-\d{2}-\d{2}$/.test(lessonDate)
    ? new Date(`${lessonDate}${OPEN_TIME_SUFFIX}`)
    : new Date(Number.NaN);
  const isConfigured = Boolean(gate && content && !Number.isNaN(openAt.getTime()));
  const isStaffPreview = Boolean(previewCode && requestedPreview === previewCode);
  let timerId;

  if (message) message.textContent = OPEN_MESSAGE;

  function applyMethodAccess() {
    const isUnlocked = isStaffPreview || (isConfigured && Date.now() >= openAt.getTime());

    body.classList.toggle("method-locked", !isUnlocked);
    body.dataset.methodAccessState = isUnlocked ? (isStaffPreview ? "preview" : "open") : "locked";
    gate?.setAttribute("aria-hidden", String(isUnlocked));
    content?.setAttribute("aria-hidden", String(!isUnlocked));

    window.clearTimeout(timerId);
    if (!isUnlocked && isConfigured) {
      const remaining = Math.max(0, openAt.getTime() - Date.now());
      timerId = window.setTimeout(applyMethodAccess, Math.min(remaining + 50, 30_000));
    }
  }

  if (!isConfigured) {
    console.error("ARCHIVE METHOD access gate is missing a valid lesson date or required container.");
  }

  applyMethodAccess();
})();
