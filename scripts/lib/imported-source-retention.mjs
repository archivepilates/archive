import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DELETE_POLICY = "delete_local_excel_after_successful_firestore_apply";

export async function cleanupImportedSourceFiles({
  apply,
  db,
  importId = "",
  kind = "",
  paths = [],
  keep = false,
}) {
  const uniquePaths = [...new Set(paths.map((item) => String(item || "").trim()).filter(Boolean))];
  const result = {
    policy: DELETE_POLICY,
    kind,
    apply: Boolean(apply),
    deletedAt: new Date().toISOString(),
    deleted: [],
    skipped: [],
    errors: [],
  };

  if (!uniquePaths.length) return await recordRetention(db, importId, result);

  if (!apply) {
    result.skipped = uniquePaths.map((filePath) => ({ path: filePath, reason: "dry_run" }));
    return await recordRetention(db, importId, result);
  }

  if (keep || process.env.ARCHIVEIN_KEEP_IMPORTED_EXCEL === "true") {
    result.skipped = uniquePaths.map((filePath) => ({ path: filePath, reason: "keep_requested" }));
    return await recordRetention(db, importId, result);
  }

  for (const filePath of uniquePaths) {
    const resolved = path.resolve(filePath);
    if (!existsSync(resolved)) {
      result.skipped.push({ path: filePath, reason: "missing" });
      continue;
    }
    if (!isManagedLocalStudioMateExcelPath(resolved)) {
      result.skipped.push({ path: filePath, reason: "protected_non_local_source" });
      continue;
    }
    try {
      await unlink(resolved);
      result.deleted.push(resolved);
    } catch (error) {
      result.errors.push({
        path: resolved,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return await recordRetention(db, importId, result);
}

function isManagedLocalStudioMateExcelPath(filePath) {
  const resolved = path.resolve(filePath);
  return managedLocalRoots().some((root) => isInside(resolved, root));
}

function managedLocalRoots() {
  const home = os.homedir();
  return [
    path.join(home, "ArchiveIN/emergency/downloads"),
    path.join(home, "ArchiveIN/emergency/archive"),
    path.join(home, "ArchiveIN/automation/downloads"),
    path.join(home, "ArchiveIN/automation/StudioMate Excel Archive"),
  ].map((item) => path.resolve(item));
}

function isInside(filePath, root) {
  const relative = path.relative(root, filePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function recordRetention(db, importId, result) {
  if (db && importId) {
    await db.collection("sourceImports").doc(importId).set(
      {
        sourceFileRetention: result,
        sourceFileDeletedAt: result.deleted.length ? result.deletedAt : "",
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }
  return result;
}
