import assert from "node:assert/strict";
import { test } from "node:test";
import { InquiryError } from "../../firebase/kangsain-functions/functions/src/memberInquiries/policy";
process.env.GCLOUD_PROJECT = "demo-inquiry-tests";

async function invoke(options: Record<string, any> = {}, controller?: any) {
  const { createPublicInquiryHandler } = await import("../../firebase/kangsain-functions/functions/src/memberInquiries/handlers");
  const headers: Record<string, string> = {}; let code = 200, output: any;
  const response = { set(name: string, value: string) { headers[name] = value; }, status(value: number) { code = value; return this; }, json(value: any) { output = value; }, send(value: any) { output = value; } };
  const request = { method: "POST", ip: "127.0.0.1", body: { test: true }, rawBody: Buffer.from("{}"),
    get(name: string) { return name === "origin" ? "https://help.archivepilates.com" : name === "content-type" ? "application/json" : ""; }, ...options };
  await createPublicInquiryHandler(controller || { submit: async () => ({ ok: true, receiptId: "mi_" + "a".repeat(32), status: "received" }) })(request, response);
  return { code, output, headers };
}
test("HTTP intake returns only controller receipt and private no-store headers", async () => {
  const result = await invoke(); assert.equal(result.code, 200); assert.deepEqual(Object.keys(result.output).sort(), ["ok", "receiptId", "status"]);
  assert.equal(result.headers["Cache-Control"], "no-store, max-age=0"); assert.equal(result.headers["Referrer-Policy"], "no-referrer");
  assert.equal(result.headers["Access-Control-Allow-Origin"], "https://help.archivepilates.com");
});
test("HTTP refuses unlisted or missing Origin without calling the database", async () => {
  for (const origin of ["https://evil.example", undefined]) {
    const result = await invoke({ get(name: string) { return name === "origin" ? origin : "application/json"; } }, { submit: () => { throw Error("must not call"); } });
    assert.equal(result.code, 403);
  }
});
test("HTTP refuses unsupported methods, non-JSON and oversized raw bodies", async () => {
  assert.equal((await invoke({ method: "GET" })).code, 405);
  assert.equal((await invoke({ get: (name: string) => name === "origin" ? "https://help.archivepilates.com" : "text/plain" })).code, 400);
  assert.equal((await invoke({ rawBody: Buffer.alloc(8193) })).code, 400);
});
test("pretransport validation and unknown outcomes are distinguished for safe retry", async () => {
  const rejected = await invoke({}, { submit: async () => { throw new InquiryError(503, "not ready"); } });
  assert.equal(rejected.output.notAccepted, true);
  const unknown = await invoke({}, { submit: async () => { throw Error("private provider error"); } });
  assert.equal(unknown.code, 503); assert.equal(unknown.output.notAccepted, false);
  assert(!JSON.stringify(unknown.output).includes("private provider"));
});
test("lookup route receives only random key and does not invoke submission", async () => {
  let called = false;
  const result = await invoke({ body: { action: "lookup", requestKey: "b".repeat(48) } }, {
    lookup: async () => { called = true; return { ok: true, receiptId: null, status: "unconfirmed" }; }, submit: () => { throw Error("must not submit"); },
  });
  assert(called); assert.equal(result.output.status, "unconfirmed");
});
