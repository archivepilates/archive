import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyStudioMateOfficialSeal } from "./studiomate-membership-contract-seal.mjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(width = 200, height = 200) {
  const bytes = Buffer.alloc(24);
  PNG_SIGNATURE.copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function fixture(t, bytes = png()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "archive-seal-test-"));
  const file = path.join(directory, "seal.png");
  await writeFile(file, bytes, { mode: 0o600 });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { file, hash: createHash("sha256").update(bytes).digest("hex") };
}

test("accepts only the exact private 200px PNG", async (t) => {
  const item = await fixture(t);
  const result = await verifyStudioMateOfficialSeal({ path: item.file, expectedHash: item.hash });
  assert.deepEqual(result, {
    path: item.file,
    sha256: item.hash,
    bytes: 24,
    width: 200,
    height: 200,
    mimeType: "image/png",
  });
});

test("rejects altered, wrong-size, public, linked and relative assets", async (t) => {
  const exact = await fixture(t);
  const altered = await fixture(t, png());
  await writeFile(altered.file, Buffer.concat([png(), Buffer.from("changed")]));
  await assert.rejects(
    verifyStudioMateOfficialSeal({ path: altered.file, expectedHash: exact.hash }),
    /does not match/,
  );

  const wrongSize = await fixture(t, png(201, 200));
  await assert.rejects(
    verifyStudioMateOfficialSeal({ path: wrongSize.file, expectedHash: wrongSize.hash }),
    /200x200/,
  );

  await chmod(exact.file, 0o644);
  await assert.rejects(
    verifyStudioMateOfficialSeal({ path: exact.file, expectedHash: exact.hash }),
    /permissions/,
  );

  await chmod(exact.file, 0o600);
  const link = `${exact.file}.link`;
  await symlink(exact.file, link);
  await assert.rejects(
    verifyStudioMateOfficialSeal({ path: link, expectedHash: exact.hash }),
    /regular file/,
  );
  await assert.rejects(
    verifyStudioMateOfficialSeal({ path: "seal.png", expectedHash: exact.hash }),
    /absolute/,
  );
});
