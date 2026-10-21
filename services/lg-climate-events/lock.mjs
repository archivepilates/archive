import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fault, LOCK_PATH } from './config.mjs';

export function isPidAlive(pid, kill = process.kill) {
  try { kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    return true; // EPERM and unknown failures cannot prove that the owner is dead.
  }
}

function owner(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024) throw fault('LOCK_INVALID');
    const data = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!Number.isSafeInteger(data.pid) || data.pid <= 0 || typeof data.token !== 'string') throw fault('LOCK_INVALID');
    return { ...data, stat };
  } finally { fs.closeSync(fd); }
}

export function acquireLock({ file = LOCK_PATH, pid = process.pid, now = Date.now,
  pidAlive = isPidAlive, staleMs = 180_000 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  // Reclaimers serialize separately so two stale readers cannot unlink a new owner.
  let reaper;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let fd;
    try {
      fd = fs.openSync(file, 'wx', 0o600);
      const identity = fs.fstatSync(fd);
      try { fs.writeFileSync(fd, JSON.stringify({ pid, token, createdAt: now() })); fs.fsyncSync(fd); }
      catch (error) { fs.unlinkSync(file); throw error; }
      return () => {
        try {
          const current = owner(file);
          if (current.pid === pid && current.token === token && current.stat.ino === identity.ino
            && current.stat.dev === identity.dev) fs.unlinkSync(file);
        } catch (error) { if (error.code !== 'ENOENT') throw fault('LOCK_RELEASE_FAILED'); }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw fault('LOCK_IO_FAILED');
      try {
        reaper = fs.openSync(`${file}.reap`, 'wx', 0o600);
        fs.writeFileSync(reaper, JSON.stringify({ pid, token, createdAt: now() }));
      } catch { throw fault('LOCK_BUSY'); }
      try {
        const current = owner(file);
        if (now() - current.stat.mtimeMs < staleMs || pidAlive(current.pid)) throw fault('LOCK_BUSY');
        fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw fault(error.code === 'LOCK_BUSY' ? 'LOCK_BUSY' : 'LOCK_INVALID');
      } finally {
        fs.closeSync(reaper); reaper = undefined;
        fs.unlinkSync(`${file}.reap`);
      }
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  throw fault('LOCK_BUSY');
}
