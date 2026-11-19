import { existsSync, lstatSync, realpathSync } from "node:fs";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archiveAutomationRoot, canonicalAutomationPath } from "./archive-automation-paths.mjs";

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
    const resolved = canonicalAutomationPath(path.resolve(filePath));
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

export function isManagedLocalStudioMateExcelPath(filePath, home = os.homedir()) {
  const resolved = canonicalAutomationPath(path.resolve(filePath), home);
  const root = managedLocalRoots(home).find(item => isInside(resolved, item));
  if (!root) return false;
  try {
    // The compatibility alias is allowed, but no nested symlink may escape the managed tree.
    return lstatSync(resolved).isFile() && realpathSync(resolved) === resolved && realpathSync(root) === root;
  } catch { return false; }
}

function managedLocalRoots(home) {
  const root = archiveAutomationRoot(home);
  return [
    path.join(root, "emergency/downloads"),
    path.join(root, "emergency/archive"),
    path.join(root, "automation/downloads"),
    path.join(root, "automation/StudioMate Excel Archive"),
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
