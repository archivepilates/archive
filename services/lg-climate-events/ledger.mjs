import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fault, STATE_PATH, VERSION } from './config.mjs';

const digest = value => typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
export function createLedger({ file = STATE_PATH, allowedDeviceIds }) {
  const allowed = new Set(allowedDeviceIds);
  let records = {};
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (fs.fstatSync(fd).size > 16_384) throw fault('LEDGER_INVALID');
      const saved = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (saved.version !== VERSION || !saved.records || Array.isArray(saved.records)) throw fault('LEDGER_INVALID');
      for (const [id, record] of Object.entries(saved.records)) {
        if (!allowed.has(id)) continue;
        if (!record || !digest(record.eventHash) || !Number.isFinite(record.receivedAt)
          || (record.messageIdHash !== null && !digest(record.messageIdHash))) throw fault('LEDGER_INVALID');
        records[id] = { eventHash: record.eventHash, receivedAt: record.receivedAt, messageIdHash: record.messageIdHash };
      }
    } finally { fs.closeSync(fd); }
  } catch (error) { if (error.code !== 'ENOENT') throw fault('LEDGER_INVALID'); }
  return {
    get: id => Object.hasOwn(records, id) ? records[id] : undefined,
    set(id, record) {
      if (!allowed.has(id)) throw fault('LEDGER_DEVICE');
      const next = { ...records, [id]: record };
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      let fd;
      try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify({ version: VERSION, records: next }));
        fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        fs.renameSync(temporary, file);
        records = next;
      } catch { throw fault('LEDGER_WRITE_FAILED'); }
      finally {
        if (fd !== undefined) fs.closeSync(fd);
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw fault('LEDGER_WRITE_FAILED'); }
      }
    },
  };
}
