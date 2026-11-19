import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function archiveAutomationRoot(home = os.homedir(), io = fs) {
  const legacy = path.join(home, "ArchiveIN"), canonical = path.join(home, "archive-automation");
  const same = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino && a?.mode === b?.mode;
  for (let attempt = 0; attempt < 3; attempt++) {
    const old = io.lstatSync(legacy, { throwIfNoEntry: false });
    const next = io.lstatSync(canonical, { throwIfNoEntry: false });
    let result, failure;
    try { result = resolve(old, next); } catch (error) { failure = error; }
    // Only reread a changing filesystem snapshot, never replay a business action.
    if (!same(old, io.lstatSync(legacy, { throwIfNoEntry: false })) ||
        !same(next, io.lstatSync(canonical, { throwIfNoEntry: false }))) continue;
    if (failure) throw failure;
    return result;
  }
  throw new Error("Unstable automation roots");

  function resolve(old, next) {
    if (old?.isDirectory() && !old.isSymbolicLink()) {
      if (old.uid !== process.getuid()) throw new Error("Unsafe legacy automation root");
      if (next && !(next.isSymbolicLink() && io.readlinkSync(canonical) === "archive-automation"))
        throw new Error("Conflicting automation roots");
      return legacy;
    }
    if (next && (!next.isDirectory() || next.isSymbolicLink() || next.uid !== process.getuid()))
      throw new Error("Unsafe canonical automation root");
    if (old && (!old.isSymbolicLink() || !next ||
        !["archive-automation", canonical].includes(io.readlinkSync(legacy)) || io.realpathSync(legacy) !== canonical))
      throw new Error("Unverified legacy automation alias");
    return canonical;
  }
}

export function archiveAutomationPath(...parts) {
  return path.join(archiveAutomationRoot(), ...parts);
}

// Normalize only the verified top-level alias; nested symlinks remain visible to callers' guards.
export function canonicalAutomationPath(value, home = os.homedir()) {
  if (typeof value !== "string") return value;
  const legacy = path.join(home, "ArchiveIN");
  if (value !== legacy && !value.startsWith(legacy + path.sep)) return value;
  return archiveAutomationRoot(home) + value.slice(legacy.length);
}
