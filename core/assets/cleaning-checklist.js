const time = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
});
const terminal = new Set(["functions/invalid-argument", "functions/permission-denied", "functions/unauthenticated"]);
function lineIcon(path) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS(ns, "path");
  line.setAttribute("d", path);
  svg.append(line);
  return svg;
}
const make = (tag, value, cls) => {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (cls) node.className = cls;
  return node;
};
function button(value, handler, primary = false) {
  const node = make("button", value);
  node.type = "button";
  if (primary) node.dataset.primary = "";
  node.addEventListener("click", handler);
  return node;
}

export function mountCleaningChecklist(host, runtime, access) {
  const uid = runtime.authClient.currentUser?.uid;
  const manager = access.role === "manager";
  const alive = () => host.isConnected && Boolean(uid) && runtime.authClient.currentUser?.uid === uid;
  const call = runtime.httpsCallable(runtime.functionsClient, "coreCleaningChecklist");
  const board = make("section", null, "cleaning-board");
  const header = make("header", null, "cleaning-bar cleaning-heading");
  const toolbar = make("div", null, "cleaning-toolbar");
  const date = make("input");
  date.type = "date";
  date.setAttribute("aria-label", "조회할 날짜");
  const day = make("span");
  const summary = make("p", null, "cleaning-summary");
  const message = make("p", null, "cleaning-status");
  message.setAttribute("role", "status");
  const list = make("section", null, "cleaning-cards");
  list.setAttribute("aria-label", "청소구역");
  const catalog = make("section", null, "cleaning-catalog");
  const pending = new Map();
  const open = new Set();
  let model;
  let busy = false;
  const reload = button("새로고침", () => read());
  const today = button("오늘", () => read(true));
  reload.className = "cleaning-refresh";
  reload.setAttribute("aria-label", "새로고침");
  reload.title = "새로고침";
  reload.replaceChildren(lineIcon("M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"));
  toolbar.append(manager ? date : day, ...(manager ? [today] : []));
  header.append(make("h1", "센터관리"), reload);
  const checklistHeading = make("div", null, "cleaning-bar cleaning-section-heading");
  checklistHeading.append(make("h2", "청소 체크리스트"), toolbar);
  board.append(header, summary, checklistHeading, message, catalog, list);
  host.replaceChildren(board);
  date.addEventListener("change", () => { if (date.value) void read(); });
  function status(text, error = false) {
    message.textContent = text;
    message.toggleAttribute("data-error", error);
  }
  function setBusy(value) {
    busy = value;
    board.setAttribute("aria-busy", String(value));
    for (const control of board.querySelectorAll("button, input")) control.disabled = value;
  }
  function paint() {
    if (!alive() || !model) return;
    date.value = model.date;
    date.max = model.today;
    day.textContent = model.date.replaceAll("-", ".");
    const active = new Map(model.items.map(item => [item.id, item]));
    const byItem = new Map(model.items.map(item => [item.id, []]));
    const archived = new Map();
    for (const record of model.records) {
      if (!byItem.has(record.itemId)) {
        if (!manager) continue;
        archived.set(record.itemId, { id: record.itemId, label: record.itemLabel, help: record.itemHelp });
        byItem.set(record.itemId, []);
      }
      byItem.get(record.itemId).push(record);
    }
    const items = model.items.map(item => ({ item, history: byItem.get(item.id) }));
    const done = items.filter(({ history }) => history[0]?.status === "done").length;
    const needs = items.filter(({ history }) => history[0]?.status === "needs-attention").length;
    summary.textContent = manager && model.date !== model.today && !model.records.length ? "이 날짜에는 청소 기록이 없어요. · 한국시간" : `완료 ${done}/${items.length} · 기록 없음 ${items.length - done - needs} · 확인 필요 ${needs} · 한국시간`;
    if (manager) {
      const rank = record => record?.status === "needs-attention" ? 0 : !record ? 1 : 2;
      items.sort((a, b) => rank(a.history[0]) - rank(b.history[0]));
    }
    if (manager) {
      paintCatalog(active);
      for (const item of archived.values()) items.push({ item, history: byItem.get(item.id) });
    }
    list.replaceChildren(...items.map(({ item: { id, label, help }, history }) => {
      const retired = !active.has(id);
      const card = make("article", null, "cleaning-card");
      const row = make("div", null, "cleaning-row");
      const title = make("div", null, "cleaning-identity");
      const count = history.filter(record => record.status === "done").length;
      const latest = history[0];
      const describe = record => `${time.format(new Date(record.recordedAt))} ${record.actorName} · ${record.status === "done" ? "완료" : "확인 필요"}${record.note ? ` (${record.note})` : ""}`;
      const state = retired ? "archived" : latest?.status || "unrecorded";
      card.dataset.state = state;
      const symbol = make("span", null, "cleaning-symbol");
      symbol.append(lineIcon(state === "done" ? "m5 12 4 4L19 6" :
        state === "needs-attention" ? "M12 5v9m0 4v.25" : "M8 5H5v14h14V5h-3m-8 0V3h8v2m-6 6h4"));
      title.append(make("h3", retired ? label + " (삭제된 구역)" : label), make("p", help, "cleaning-help"));
      const badge = make("span", state === "done" ? "완료" : state === "needs-attention" ?
        "확인 필요" : state === "archived" ? "보관" : "미기록", "cleaning-badge");
      row.append(symbol, title, badge);
      card.append(row, make("p", latest ? `최근 ${describe(latest)} · 완료 ${count}회` : "아직 기록 없음", "cleaning-latest"));
      if (!retired && model.date === model.today) {
        const actions = make("div", null, "cleaning-actions");
        const retry = pending.get(id);
        const noteForm = make("form", null, "cleaning-note");
        noteForm.hidden = true;
        const labelNode = make("label", "메모 ");
        const input = make("input");
        input.maxLength = 160; input.required = true;
        input.placeholder = "예: 바디워시 재고 없음";
        labelNode.append(input);
        const submit = make("button", "확인 필요 저장"); submit.type = "submit";
        noteForm.append(labelNode, submit);
        noteForm.addEventListener("submit", event => {
          event.preventDefault();
          if (input.value.trim()) void record(id, "needs-attention", input.value.trim());
        });
        if (retry) actions.append(button("같은 기록 다시 확인", () => record(id, retry.status, retry.note), true));
        else {
          actions.append(button("완료 기록", () => record(id, "done", ""), true),
            button("확인 필요", () => { noteForm.hidden = !noteForm.hidden; if (!noteForm.hidden) input.focus(); }));
        }
        card.append(actions, noteForm);
      }
      if (history.length) {
        const detail = make("details");
        detail.open = open.has(id);
        detail.addEventListener("toggle", () => { if (detail.open) open.add(id); else open.delete(id); });
        const log = make("ul", null, "cleaning-history");
        log.append(...history.map(record => make("li", describe(record) + (record.itemLabel !== label ? ` · 당시 구역: ${record.itemLabel}` : ""))));
        detail.append(make("summary", `전체 기록 ${history.length}건`), log);
        card.append(detail);
      }
      return card;
    }));
  }
  let catalogExpanded = false;
  function paintCatalog(active) {
    catalog.replaceChildren();
    if (model.date !== model.today) return;
    const panel = make("details");
    panel.open = catalogExpanded;
    panel.addEventListener("toggle", () => { catalogExpanded = panel.open; });
    panel.append(make("summary", "청소구역 관리"));
    panel.append(make("p", "변경 사항은 오늘 목록부터 적용돼요. 기존 완료 이력은 유지돼요.", "cleaning-help"));
    const form = make("form", null, "cleaning-area-form");
    const name = make("input"), help = make("input");
    name.required = true; name.maxLength = 50;
    help.maxLength = 160;
    const nameLabel = make("label", "구역 이름 "), helpLabel = make("label", "작업 안내 ");
    nameLabel.append(name); helpLabel.append(help);
    let editing = "";
    const submit = make("button", "구역 추가"); submit.type = "submit";
    const cancel = button("수정 취소", () => {
      editing = ""; name.value = ""; help.value = ""; submit.textContent = "구역 추가"; cancel.hidden = true;
    });
    cancel.hidden = true;
    form.append(nameLabel, helpLabel, submit, cancel);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!name.value.trim()) return;
      void changeCatalog({ operation: editing ? "edit" : "add", ...(editing ? { itemId: editing } : {}),
        label: name.value.trim(), help: help.value.trim() });
    });
    panel.append(form);
    const zoneList = make("ul", null, "cleaning-zones");
    for (const {id, label, help: instructions} of active.values()) {
      const zone = make("li");
      const deletion = make("span", null, "cleaning-actions");
      deletion.hidden = true;
      const remove = button("삭제", () => { deletion.hidden = false; confirm.focus(); });
      const confirm = button("삭제 확인", () => changeCatalog({ operation: "delete", itemId: id }));
      deletion.append(make("span", "목록에서 삭제할까요?"), confirm,
        button("취소", () => { deletion.hidden = true; remove.focus(); }));
      zone.append(make("span", label), button("수정", () => {
        editing = id; name.value = label; help.value = instructions; submit.textContent = "변경 저장";
        cancel.hidden = false; name.focus();
      }), remove, deletion);
      zoneList.append(zone);
    }
    panel.append(zoneList);
    catalog.append(panel);
  }
  async function changeCatalog(change) {
    if (busy || !alive() || !manager || model?.date !== model?.today) return;
    setBusy(true);
    status("청소구역을 저장하는 중이에요.");
    let saved = false;
    try {
      await call({ action: "catalog", revision: model.revision, ...change });
      saved = true;
      if (!alive()) return;
      await fetchDay("");
      if (alive()) status("청소구역을 반영했어요.");
    } catch (error) {
      if (!alive()) return;
      status(saved ? "저장했어요. 새로고침해 반영 내용을 확인해 주세요."
        : terminal.has(error?.code) ? error.message : "저장 결과를 확인하지 못했어요. 새로고침 후 목록을 확인해 주세요.", true);
    } finally { if (alive()) setBusy(false); }
  }
  async function fetchDay(requestedDate) {
    const { data } = await call(requestedDate ? { action: "read", date: requestedDate } : { action: "read" });
    if (!alive()) return;
    if (model?.date !== data.date) open.clear();
    for (const [itemId, request] of pending) if (request.date !== data.date) pending.delete(itemId);
    model = data;
    paint();
  }
  async function read(reset = false) {
    if (busy || !alive()) return;
    setBusy(true);
    status("기록을 불러오는 중이에요.");
    try {
      await fetchDay(manager && !reset ? date.value : "");
      if (alive()) status("");
    } catch {
      if (!alive()) return;
      if (model) date.value = model.date;
      status("기록을 불러오지 못했어요. 새로고침해 주세요.", true);
    } finally { if (alive()) setBusy(false); }
  }
  async function record(itemId, nextStatus, note) {
    if (busy || !alive() || !model || model.date !== model.today || !model.items.some(item => item.id === itemId)) return;
    const request = pending.get(itemId) || { action: "record", date: model.date, itemId,
      status: nextStatus, note, revision: model.revision, requestId: crypto.randomUUID() };
    pending.set(itemId, request);
    setBusy(true);
    status("기록을 저장하는 중이에요.");
    let saved = false;
    try {
      await call(request);
      saved = true;
      pending.delete(itemId);
      if (!alive()) return;
      await fetchDay("");
      if (alive()) status("기록했어요.");
    } catch (error) {
      if (!alive()) return;
      const denied = terminal.has(error?.code);
      if (denied) pending.delete(itemId);
      paint();
      status(saved ? "저장했어요. 화면에 반영하려면 새로고침해 주세요." : denied
        ? "저장할 수 없어요. 새로고침해 오늘 날짜와 권한을 확인해 주세요."
        : "저장 결과를 확인하지 못했어요. ‘같은 기록 다시 확인’을 눌러 주세요.", true);
    } finally { if (alive()) setBusy(false); }
  }
  void read(true);
}
