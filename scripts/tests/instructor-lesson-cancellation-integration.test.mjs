import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, test } from "node:test";
import { build } from "esbuild";
import { codebasesForFile } from "../lib/affected-functions.mjs";
import { importInstructorOrder } from "../lib/imweb-instructor-orders.mjs";
import { assessInstructorOrder, IMWEB_LESSON_POLICY, orderLedgerId } from "../lib/imweb-instructor-order-policy.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const ts = createRequire(new URL("../../firebase/kangsain-functions/functions/package.json", import.meta.url))("typescript");
const now = new Date("2026-09-27T12:30:00.000Z");
beforeEach((t) => t.mock.timers.enable({ apis: ["Date"], now }));

// Reuse the existing ingest fixture and transaction mock without registering its tests.
function ingestHarness() {
  const file = new URL("./imweb-instructor-order-ingest.test.mjs", import.meta.url);
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(fileURLToPath(file), source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const constants = new Set(["NOW", "ORDER_NO", "LESSON_DATE", "TICKET", "STUDIO", "clone"]);
  const functions = new Set(["fixture", "paths", "field", "patch", "mockDb"]);
  const declarations = [];
  const found = new Set();
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && functions.has(node.name?.text)) {
      declarations.push(node.getText(ast));
      found.add(node.name.text);
    } else if (ts.isVariableStatement(node)) {
      const names = node.declarationList.declarations.map((declaration) => declaration.name.getText(ast));
      if (names.every((name) => constants.has(name))) {
        declarations.push(node.getText(ast));
        for (const name of names) found.add(name);
      }
    }
  }
  for (const name of [...constants, ...functions]) assert.ok(found.has(name), `Existing ingest helper missing: ${name}`);
  return new Function("dependencies", `
    const { assert, importInstructorOrder, assessInstructorOrder, IMWEB_LESSON_POLICY, orderLedgerId } = dependencies;
    ${declarations.join("\n")}
    return { fixture, paths, mockDb };
  `)({ assert, importInstructorOrder, assessInstructorOrder, IMWEB_LESSON_POLICY, orderLedgerId });
}

const harness = ingestHarness();
const cancellationStates = [
  ["cancellation_pending", "pending"],
  ["cancellation_pending", "processing"],
  ["cancellation_review", "review_required"],
  ["cancelled", "completed"],
];
const changes = {
  recipient(order) { order.ordererName = "Changed synthetic learner"; order.ordererCall = "01000000002"; },
  date(order) { order.sections[0].sectionItems[0].productInfo.optionInfo["수강일"] = "2026년 10월 11일(일)"; },
  recipient_and_date(order) { changes.recipient(order); changes.date(order); },
};

for (const [change, modify] of Object.entries(changes)) {
  for (const [registrationStatus, cancellationStatus] of cancellationStates) {
    test(`changed Imweb ${change} preserves ${registrationStatus}/${cancellationStatus}, including transaction replay`, async () => {
      for (const retryOnce of [false, true]) {
        const store = harness.mockDb({}, { retryOnce });
        const original = harness.fixture();
        const oldKeys = harness.paths(original);
        assert.equal((await store.ingest(original)).status, "queued");
        const cancellation = { jobId: "synthetic-cancellation", status: cancellationStatus,
          reason: "Operator cancellation", nativeVerified: cancellationStatus === "completed" };
        store.seed(oldKeys.registration, { ...store.get(oldKeys.registration), status: registrationStatus,
          cancellation, nextAction: "Retain cancellation operator action", lastError: "Retain cancellation detail" });
        store.seed(oldKeys.job, { ...store.get(oldKeys.job), status: "cancelled", cancellationJobId: cancellation.jobId });
        const cancellationPath = `studiomateInstructorLessonCancellations/${cancellation.jobId}`;
        const consentPath = "instructorMemberConsents/synthetic-existing-consent";
        store.seed(cancellationPath, { ...cancellation, registrationId: oldKeys.registration.split("/").at(-1),
          paymentRefundAllowed: false });
        store.seed(consentPath, { status: "completed", documentId: "synthetic-existing-document", immutable: "Retain existing consent" });
        const before = store.all();
        const changed = harness.fixture(modify);
        const newKeys = harness.paths(changed);
        assert.notEqual(newKeys.registration, oldKeys.registration, "Must exercise the old-registration branch");
        const commitStart = store.commits.length;
        const result = await store.ingest(changed);
        assert.ok(["unchanged", "review_required"].includes(result.status));
        assert.deepEqual(store.get(oldKeys.registration), before[oldKeys.registration],
          "Order changes must not replace cancellation status, evidence or operator action");
        assert.deepEqual(store.get(oldKeys.job), before[oldKeys.job], "Cancelled registration job cannot resume");
        assert.deepEqual(store.get(cancellationPath), before[cancellationPath]);
        assert.deepEqual(store.get(consentPath), before[consentPath], "Existing consent must remain intact");
        assert.equal(store.get(newKeys.registration), undefined, "No replacement registration may be admitted");
        assert.equal(store.get(newKeys.job), undefined, "No replacement ticket job may be created");
        assert.equal(store.get(oldKeys.ledger).registrationId, before[oldKeys.ledger].registrationId);
        assert.ok(store.commits.slice(commitStart).flat().every((write) => write.key === oldKeys.ledger),
          "Only order-ledger review metadata may change");
      }
    });
  }
}

let consumersPromise;
function compiledPolicyConsumers() {
  consumersPromise ||= (async () => {
    const policy = "firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonCancellationPolicy.ts";
    const manifest = JSON.parse(readFileSync(new URL("../../firebase/codebase-boundaries.json", import.meta.url), "utf8"));
    const consumers = [];
    for (const [codebase, config] of Object.entries(manifest.targetCodebases)) {
      const compiled = await build({ absWorkingDir: repoRoot, entryPoints: [config.sourceEntrypoint],
        bundle: true, write: false, platform: "node", packages: "external", metafile: true, logLevel: "silent" });
      if (Object.hasOwn(compiled.metafile.inputs, policy)) consumers.push(codebase);
    }
    return { policy, consumers: consumers.sort() };
  })();
  return consumersPromise;
}

test("compiled app and Alimtalk entrypoints both consume the cancellation policy", async () => {
  const { consumers } = await compiledPolicyConsumers();
  assert.ok(consumers.includes("functions-app"), "Cancellation callable must consume its policy");
  assert.ok(consumers.includes("functions-alimtalk"), "Cancellation send guards must be compiled into Alimtalk");
});

test("affected detector covers every compiled cancellation-policy consumer", async () => {
  const { policy, consumers } = await compiledPolicyConsumers();
  const detected = codebasesForFile(policy);
  assert.deepEqual(detected, consumers,
    `Policy-only changes must redeploy all compiled consumers; graph=${consumers.join(",")}, detector=${detected.join(",")}`);
});
