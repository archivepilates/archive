import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export async function privateDirectory(directory) {
  const firstCreated = await fs.mkdir(directory, {recursive: true, mode: 0o700});
  const s = await fs.lstat(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || s.mode & 0o077) throw Error('Owned private directory required');
  if (firstCreated) {
    const existingParent = path.dirname(firstCreated);
    for (let current = path.resolve(directory); ; current = path.dirname(current)) {
      const handle = await fs.open(current, 'r');
      try {await handle.sync();} finally {await handle.close();}
      if (current === existingParent) break;
    }
  }
}

export async function savePrivateJson(file, value, {replace = false} = {}) {
  await privateDirectory(path.dirname(file));
  const temp = replace ? `${file}.${randomUUID()}.tmp` : file;
  const handle = await fs.open(temp, 'wx', 0o600);
  try {await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync();} finally {await handle.close();}
  if (replace) await fs.rename(temp, file);
  const parent = await fs.open(path.dirname(file), 'r');
  try {await parent.sync();} finally {await parent.close();}
}

export function createClassCorrectionLedger(directory) {
  const file = key => {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw Error('Invalid canonical correction key');
    return path.join(directory, key + '.json');
  };
  const read = async key => {
    await privateDirectory(directory);
    const target = file(key);
    try {
      const s = await fs.lstat(target);
      if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid() || s.mode & 0o077) throw Error('Unsafe canonical correction record');
      const result = JSON.parse(await fs.readFile(target, 'utf8'));
      if (result.key !== key || !Number.isInteger(result.revision) || result.revision < 1) throw Error('Invalid canonical correction record');
      return result;
    } catch (e) {if (e.code === 'ENOENT') return null; throw e;}
  };
  return {
    read,
    async claim(key, evidence) {
      await privateDirectory(directory);
      if (await read(key)) return false;
      try {await savePrivateJson(file(key), {...evidence, key, revision: 1, status: 'intent', claimedAt: new Date().toISOString()}); return true;}
      catch (e) {if (e.code === 'EEXIST') return false; throw e;}
    },
    async update(key, patch) {
      const current = await read(key);
      if (!current || current.status === 'verified' || current.status === 'unknown') throw Error('Terminal or missing claim cannot be replayed or replaced');
      if (!['intent', 'submitted', 'unknown', 'verified', 'review'].includes(patch.status)) throw Error('Invalid correction transition');
      // The caller holds the shared native profile lock for the complete worker lifetime.
      await savePrivateJson(file(key), {...current, ...patch, key, revision: current.revision + 1, updatedAt: new Date().toISOString()}, {replace: true});
    },
  };
}
