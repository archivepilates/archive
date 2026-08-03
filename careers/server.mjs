import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, "dist");
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = "0.0.0.0";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

if (!existsSync(path.join(distDir, "index.html"))) {
  throw new Error("Missing dist/index.html. Run npm run build before starting the server.");
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function serveFile(request, response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const cacheControl = filePath.includes(`${path.sep}assets${path.sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  response.writeHead(200, {
    "cache-control": cacheControl,
    "content-length": statSync(filePath).size,
    "content-type": contentTypes.get(extension) ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { success: false, message: "Not found" });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { success: false, message: "Method not allowed" });
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    sendJson(response, 400, { success: false, message: "Invalid path" });
    return;
  }

  const relativePath = decodedPath.replace(/^\/+/, "");
  const candidatePath = path.resolve(distDir, relativePath);
  const isInsideDist = candidatePath === distDir || candidatePath.startsWith(`${distDir}${path.sep}`);
  const isFile = isInsideDist && existsSync(candidatePath) && statSync(candidatePath).isFile();
  const filePath = isFile ? candidatePath : path.join(distDir, "index.html");
  serveFile(request, response, filePath);
});

server.listen(port, host, () => {
  console.info(`ARCHIVE PILATES Careers listening on ${host}:${port}`);
});
