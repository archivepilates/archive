import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 43000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {
      // The server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready.\n${output}`);
}

try {
  await waitForServer();

  const root = await fetch(`${origin}/`);
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await root.text(), /<title>ARCHIVE PILATES Careers<\/title>/);

  const spa = await fetch(`${origin}/careers/open-role`);
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /<div id="root"><\/div>/);

  const missingApi = await fetch(`${origin}/api/missing`);
  assert.equal(missingApi.status, 404);

  const applicationApi = await fetch(`${origin}/api/apply`, { method: "POST" });
  assert.equal(applicationApi.status, 404);

  console.info("careers runtime smoke passed");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
