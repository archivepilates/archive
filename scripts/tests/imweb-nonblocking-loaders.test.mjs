import assert from "node:assert/strict";
import test from "node:test";
import { LOADERS, makeLoaderAsync, executionBlocker } from "../imweb-nonblocking-loaders.mjs";

for (const name of Object.keys(LOADERS)) {
  test(`${name}: only the async attribute changes; repeated preparation is stable`, () => {
    const source = `<!-- preserve -->\n${LOADERS[name]}</script>\n<script>window.keep = true;</script>\n`;
    const result = makeLoaderAsync(source, name);
    assert.equal(result.replace("<script async ", "<script "), source);
    assert.equal(result.length - source.length, 6);
    assert.equal(makeLoaderAsync(result, name), result);
  });
  test(`${name}: missing, duplicate or changed loaders cannot be overwritten`, () => {
    assert.throws(() => makeLoaderAsync("unrelated", name));
    assert.throws(() => makeLoaderAsync(LOADERS[name].repeat(2), name));
    assert.throws(() => makeLoaderAsync(LOADERS[name].replace(".js", "-new.js"), name));
    assert.throws(() => makeLoaderAsync(LOADERS[name] + LOADERS[name].replace("<script ", "<script async "), name));
  });
}
test("unsupported loader names and non-string inputs are rejected", () => {
  assert.throws(() => makeLoaderAsync("", "other"));
  assert.throws(() => makeLoaderAsync(null, "tracker"));
});
test("a misleading ready preflight cannot bypass the CLI write unit limit", () => {
  assert.ok(executionBlocker({ safety: { execute_ready: true, bulk_units: 936, single_request_hard_limit: 50 } }));
  assert.equal(executionBlocker({ safety: { bulk_units: 1, single_request_hard_limit: 50 } }), "");
});
