(() => {
  "use strict";

  // Consume the secret before DOM work or requests; retain it only in this closure.
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  const token = fragment.get("token") || "";
  const view = fragment.get("view");
  const registrationId = query.get("id") || "";
  let fragmentRemoved = false;
  try {
    window.history.replaceState(null, "", window.location.pathname +
      (registrationId ? `?id=${encodeURIComponent(registrationId)}` : ""));
    fragmentRemoved = !window.location.hash;
  } catch {
    // If URL cleanup fails, do not send the secret anywhere.
  }
  const validLink = fragmentRemoved && query.getAll("id").length === 1 &&
    fragment.getAll("token").length === 1 && /^ilr_[a-f0-9]{24}$/.test(registrationId) &&
    /^[a-f0-9]{64}$/.test(token);
  const endpoint = window.location.hostname === "in.archivepilates.com"
    ? "/api/instructorWaitlist"
    : window.location.hostname === "archive-pilates.web.app"
      ? "/archivein/api/instructorWaitlist" : null;

  document.addEventListener("DOMContentLoaded", initialize, { once: true });

  function initialize() {
    const byId = id => document.getElementById(id);
    const icon = `${window.location.hostname === "archive-pilates.web.app" ? "/archivein" : ""}/onsiteWelcome/icons/archive-pilates-icon-192.png`;
    byId("brandIcon").href = icon;
    byId("brandMark").src = icon;
    const page = byId("waitlistPage");
    const loading = byId("loading");
    const details = byId("details");
    const message = byId("message");
    const cancelButton = byId("cancelButton");
    const refreshButton = byId("refreshButton");
    let current = null;
    let busy = false;
    let cancellationUncertain = false;

    function setBusy(value) {
      busy = value;
      page.setAttribute("aria-busy", String(value));
      cancelButton.disabled = value;
      refreshButton.disabled = value;
      cancelButton.textContent = value ? "확인 중" : "대기 취소";
    }

    function showMessage(text) {
      message.textContent = text;
      message.hidden = !text;
    }

    function dateValue(value) {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const date = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
    }

    function validStatus(data) {
      return data && data.ok === true && dateValue(data.lessonDate) &&
        ["waitlisted", "cancelled", "confirmed", "closed"].includes(data.status) &&
        (data.position === null || (Number.isSafeInteger(data.position) && data.position > 0)) &&
        typeof data.canCancel === "boolean";
    }

    async function request(action) {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action, registrationId, token, ...(action === "cancel" ? { confirm: true } : {}) }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok || !validStatus(data)) throw new Error("Unavailable");
      return data;
    }

    function render(data) {
      current = data;
      loading.hidden = true;
      details.hidden = false;
      byId("lessonDate").textContent = new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "short",
      }).format(dateValue(data.lessonDate));
      byId("status").textContent = {
        waitlisted: "대기 중", cancelled: "대기 취소 완료", confirmed: "등록 확정", closed: "대기 종료",
      }[data.status];
      byId("positionRow").hidden = data.status !== "waitlisted";
      byId("position").textContent = data.status === "waitlisted"
        ? (data.position === null ? "확인 중" : `${data.position}번`) : "";
      byId("note").textContent = {
        waitlisted: "대기는 수강 확정이 아닙니다. 현재 순번은 대기 상황에 따라 달라질 수 있습니다.",
        cancelled: "대기가 취소되었습니다.",
        confirmed: "수강 등록이 확정되었습니다. 변경이 필요하면 ARCHIVE PILATES로 문의해 주세요.",
        closed: "이 수업의 대기가 종료되었습니다.",
      }[data.status];
      cancelButton.hidden = cancellationUncertain || data.status !== "waitlisted" || !data.canCancel;
      refreshButton.hidden = false;
    }

    async function readStatus() {
      if (busy) return;
      setBusy(true);
      showMessage("");
      try {
        render(await request("status"));
        if (cancellationUncertain) showMessage("현재 상태를 확인했습니다. 취소 요청은 다시 보내지 않았습니다. 취소 여부가 불분명하면 ARCHIVE PILATES로 문의해 주세요.");
      } catch {
        current = null;
        details.hidden = true;
        cancelButton.hidden = true;
        loading.hidden = true;
        refreshButton.hidden = false;
        showMessage("대기 정보를 확인하지 못했습니다. 상태를 다시 확인하거나 ARCHIVE PILATES로 문의해 주세요.");
      } finally {
        setBusy(false);
      }
    }

    async function cancelWaitlist() {
      if (busy || cancellationUncertain || current?.status !== "waitlisted" || !current.canCancel) return;
      if (!window.confirm("강사레슨 대기를 취소하시겠습니까? 취소하면 현재 대기 순번이 유지되지 않습니다.")) return;
      setBusy(true);
      showMessage("");
      try {
        const result = await request("cancel");
        render(result);
        if (result.status === "waitlisted") {
          cancellationUncertain = true;
          cancelButton.hidden = true;
          showMessage("대기 취소가 확인되지 않았습니다. 취소 요청을 다시 보내지 말고 ARCHIVE PILATES로 문의해 주세요.");
        }
      } catch {
        // A lost response is not proof of failure. Reconcile once; never replay the mutation.
        cancellationUncertain = true;
        cancelButton.hidden = true;
        current = null;
        details.hidden = true;
        try {
          const result = await request("status");
          render(result);
          showMessage(result.status === "cancelled" ? "현재 상태를 다시 확인했습니다. 대기 취소가 완료되었습니다."
            : "현재 상태를 다시 확인했습니다. 취소 완료는 확인되지 않았습니다. 취소 요청은 다시 보내지 않았습니다. ARCHIVE PILATES로 문의해 주세요.");
        } catch {
          showMessage("취소 결과를 확인하지 못했습니다. 취소 요청을 다시 보내지 말고 상태를 확인하거나 ARCHIVE PILATES로 문의해 주세요.");
        }
      } finally {
        setBusy(false);
      }
    }

    cancelButton.addEventListener("click", cancelWaitlist);
    refreshButton.addEventListener("click", readStatus);
    if (!validLink || !endpoint) {
      loading.hidden = true;
      setBusy(false);
      showMessage("대기 확인 링크가 올바르지 않거나 만료되었습니다. 안내받은 원래 링크를 다시 열어 주세요.");
      return;
    }
    readStatus().then(() => {
      if (view === "cancel" && !cancelButton.hidden) cancelButton.focus();
    });
  }
})();
