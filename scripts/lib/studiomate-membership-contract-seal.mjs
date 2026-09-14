import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OFFICIAL_SEAL_SHA256 =
  "8aa7cc2bf0fb4c43809d753a505898a305b5d0340147f78364eb9ef56795ff8f";
export const DEFAULT_OFFICIAL_SEAL_PATH = path.join(
  os.homedir(),
  "ArchiveIN/automation/assets/archive-pilates-official-seal.png",
);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SEAL_BYTES = 3 * 1024 * 1024;
const EXPECTED_DIMENSION = 200;

export async function verifyStudioMateOfficialSeal(input = {}) {
  const sealPath = resolveSealPath(input.path || process.env.STUDIOMATE_OFFICIAL_SEAL_PATH);
  const expectedHash = String(input.expectedHash || OFFICIAL_SEAL_SHA256).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("Official seal SHA-256 is invalid.");

  const metadata = await lstat(sealPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Official seal must be a regular file, not a link.");
  }
  if (metadata.size <= 0 || metadata.size > MAX_SEAL_BYTES) {
    throw new Error("Official seal file size is outside the allowed range.");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("Official seal permissions must not allow group or other access.");
  }

  const bytes = await readFile(sealPath);
  const dimensions = readPngDimensions(bytes);
  if (dimensions.width !== EXPECTED_DIMENSION || dimensions.height !== EXPECTED_DIMENSION) {
    throw new Error(`Official seal must be ${EXPECTED_DIMENSION}x${EXPECTED_DIMENSION}px.`);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedHash) throw new Error("Official seal SHA-256 does not match the approved image.");

  return Object.freeze({
    path: sealPath,
    sha256,
    bytes: metadata.size,
    width: dimensions.width,
    height: dimensions.height,
    mimeType: "image/png",
  });
}

function resolveSealPath(value) {
  const raw = String(value || DEFAULT_OFFICIAL_SEAL_PATH).trim();
  const expanded = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
  if (!path.isAbsolute(expanded)) throw new Error("Official seal path must be absolute.");
  return path.normalize(expanded);
}

function readPngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Official seal must be a valid PNG file.");
  }
  if (bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Official seal PNG is missing the IHDR header.");
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}
