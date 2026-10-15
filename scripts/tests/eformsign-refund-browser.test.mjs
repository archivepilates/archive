import assert from "node:assert/strict";
import test, { before, after, afterEach } from "node:test";
import { chromium } from "playwright";
import { readRefundSendEvidence, waitForRefundTemplateReady } from "../lib/eformsign-refund-evidence.mjs";

const documentName = "synthetic_refund_12345678";
const recipientPhone = "01000000000";
const listUrl = "https://refund-fixture.invalid/eform/document/document_list.html?mode=ip";
const editorUrl = "https://refund-fixture.invalid/eform/document/view_service.html?document_id=unrelated-url-id";
let browser;

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); assert.equal(browser?.isConnected(), false); });
afterEach(() => { assert.equal(browser.contexts().length, 0, "every fixture context must close"); });

async function withPage(html, action, url = listUrl) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    await context.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><body></body>" }));
    const page = await context.newPage();
    await page.goto(url);
    await page.setContent(html);
    return await action(page);
  } finally {
    await context.close();
  }
}

const read = (page) => readRefundSendEvidence(page, documentName, recipientPhone);
const assertEmpty = (evidence) => assert.deepEqual(evidence, { bodyText: "", documentId: "", url: evidence.url, evidenceScope: "" });
const row = (status = "In progress", phone = "010-0000-0000", id = "doc-one") =>
  `<tr data-document-id="${id}"><td>${documentName}</td><td>${status}</td><td>${phone}</td></tr>`;

test("English and Korean visible rows bind name, full phone, status and document ID in the same record", async () => {
  for (const status of ["In progress", "Completed", "진행 중", "완료"]) {
    await withPage(`<nav>GLOBAL NAVIGATION</nav><table>${row(status)}</table>`, async (page) => {
      const evidence = await read(page);
      assert.equal(evidence.documentId, "doc-one");
      assert.equal(evidence.evidenceScope, "document_record");
      assert.ok(evidence.bodyText.includes(documentName));
      assert.ok(!evidence.bodyText.includes("GLOBAL NAVIGATION"));
    });
  }
});

test("relative document links and repeated references to the same ID are scoped to their record", async () => {
  await withPage(`<article><ul><li data-doc-id="doc-one"><a href="/eform/document/detail?document_id=doc-one">${documentName}</a><span>처리 중</span><span>+821000000000</span></li></ul></article>`, async (page) => {
    const evidence = await read(page);
    assert.equal(evidence.documentId, "doc-one");
    assert.equal(evidence.evidenceScope, "document_record");
  });
});

test("role rows, document items and articles provide the same smallest-record proof", async () => {
  for (const attributes of ["role='row'", "class='document-item'", "class='list-item'"]) {
    await withPage(`<article><div ${attributes} data-doc-id="doc-one"><span>${documentName}</span><span>Completed</span><span>010-0000-0000</span></div><p>OUTSIDE RECORD</p></article>`, async (page) => {
      const evidence = await read(page);
      assert.equal(evidence.documentId, "doc-one");
      assert.ok(!evidence.bodyText.includes("OUTSIDE RECORD"));
    });
  }
  await withPage(`<article data-doc-id="doc-one"><span>${documentName}</span><span>Completed</span><span>010-0000-0000</span></article>`, async (page) => {
    assert.equal((await read(page)).documentId, "doc-one");
  });
});

test("correct phone in another row or outer article never repairs a wrong-recipient row", async () => {
  await withPage(`<article><table>${row("Completed", "010-1111-2222")}<tr><td>Other document</td><td>010-0000-0000</td></tr></table></article>`, async (page) => assertEmpty(await read(page)));
  await withPage(`<article><table><tr><td>${documentName}</td><td>Completed</td><td>010-0000-0000</td></tr><tr data-doc-id="other-id"><td>Other document</td></tr></table></article>`, async (page) => assertEmpty(await read(page)));
});

test("navigation Completed does not turn a draft row into sent proof", async () => {
  for (const status of ["Draft", "초안", "Recipient", "수신자"]) {
    await withPage(`<nav>Completed 완료</nav><table>${row(status)}</table>`, async (page) => assertEmpty(await read(page)));
  }
});

test("hidden records, hidden recipient text and partial title matches are not evidence", async () => {
  for (const html of [
    `<table hidden>${row()}</table>`,
    `<table style="opacity:0">${row()}</table>`,
    `<table><tr data-doc-id="doc-one"><td>${documentName}</td><td>Completed</td><td hidden>010-0000-0000</td></tr></table>`,
    `<table>${row().replace(documentName, `${documentName}_other`)}</table>`,
    `<table>${row("Completed", "010-****-0000")}</table>`,
  ]) await withPage(html, async (page) => assertEmpty(await read(page)));
});

test("one record containing multiple document IDs is refused rather than selecting the first", async () => {
  await withPage(`<table><tr data-document-id="doc-one" data-doc-id="doc-two"><td>${documentName}</td><td>Completed</td><td>010-0000-0000</td></tr></table>`, async (page) => assertEmpty(await read(page)));
  await withPage(`<table><tr data-document-id="doc-one"><td><a href="/eform/document/detail?document_id=doc-two">${documentName}</a></td><td>Completed</td><td>010-0000-0000</td></tr></table>`, async (page) => assertEmpty(await read(page)));
  await withPage(`<table>${row("Completed", "010-0000-0000", "doc-one")}${row("Completed", "010-0000-0000", "doc-two")}</table>`, async (page) => assertEmpty(await read(page)));
});

test("hidden duplicate IDs do not override the single visible document ID", async () => {
  await withPage(`<article data-doc-id="doc-one"><span>${documentName}</span><span>Completed</span><span>010-0000-0000</span><a hidden href="/eform/document/detail?document_id=hidden-id">Hidden link</a></article>`, async (page) => {
    assert.equal((await read(page)).documentId, "doc-one");
  });
});

test("positive dialog and alert confirmations require their own bound ID, not the page URL", async () => {
  for (const [role, status] of [["dialog", "The document has been sent."], ["alert", "문서를 전송했습니다."]]) {
    await withPage(`<div role="${role}" data-document-id="confirmation-id"><span>${documentName}</span><p>${status}</p><span>010-0000-0000</span></div>`, async (page) => {
      const evidence = await read(page);
      assert.equal(evidence.documentId, "confirmation-id");
      assert.equal(evidence.evidenceScope, "send_confirmation");
    }, editorUrl);
    await withPage(`<div role="${role}"><span>${documentName}</span><p>${status}</p><span>010-0000-0000</span></div>`, async (page) => assertEmpty(await read(page)), editorUrl);
  }
});

test("negative sent wording and cross-dialog recipient evidence never count as confirmation", async () => {
  for (const status of ["The document was not sent.", "Document sent unsuccessfully.", "문서를 전송하지 못했습니다."]) {
    await withPage(`<div role="dialog" data-doc-id="doc-one"><span>${documentName}</span><p>${status}</p><span>010-0000-0000</span></div>`, async (page) => assertEmpty(await read(page)), editorUrl);
  }
  await withPage(`<div role="dialog" data-doc-id="doc-one"><span>${documentName}</span><p>The document has been sent.</p><span>010-1111-2222</span></div><div role="alert">010-0000-0000</div>`, async (page) => assertEmpty(await read(page)), editorUrl);
});

test("template readiness waits for delayed English and Korean buttons without fixed sleeps", async () => {
  for (const name of ["Fill in", "입력 시작"]) {
    await withPage(`<script>window.buttonGate = new Promise(resolve => { window.releaseButton = resolve; }); window.buttonGate.then(name => { const button = document.createElement('button'); button.textContent = name; document.body.append(button); });</script>`, async (page) => {
      const pending = waitForRefundTemplateReady(page);
      await page.evaluate((label) => window.releaseButton(label), name);
      const button = await pending;
      assert.equal(await button.textContent(), name);
    }, editorUrl);
  }
});

test("template readiness ignores hidden duplicates and returns the visible matching button", async () => {
  await withPage(`<button hidden>Fill in</button><button style="display:none">입력 시작</button><button data-fixture="visible">Fill in</button>`, async (page) => {
    const button = await waitForRefundTemplateReady(page);
    assert.equal(await button.getAttribute("data-fixture"), "visible");
  }, editorUrl);
});

test("missing template buttons time out and fixture context still closes", async () => {
  await withPage("<button>Other action</button>", async (page) => {
    await assert.rejects(() => waitForRefundTemplateReady(page, { timeout: 50 }), { name: "TimeoutError" });
  }, editorUrl);
});

test("fixture errors still close every task-owned context", async () => {
  await assert.rejects(() => withPage("<p>Local fixture</p>", async () => {
    throw new Error("Synthetic fixture failure");
  }), /Synthetic fixture failure/);
  assert.equal(browser.contexts().length, 0);
});
