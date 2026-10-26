#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { readImwebOrder } from './lib/imweb-instructor-orders.mjs';
import { admitInstructorOrderAttendees } from './lib/imweb-instructor-order-attendees.mjs';

const args = process.argv.slice(2);
const get = key => args[args.indexOf(key) + 1];
if (args.includes('--help')) {
  console.log('Usage: node scripts/resolve-imweb-instructor-order-attendees.mjs --input OWNER_ONLY_JSON [--apply]\nDefault: read-only dry-run. No worker execution or member messages.');
  process.exit(0);
}
if (!args.includes('--input')) throw new Error('소유자 전용 실제 수강자 JSON 파일(--input) 필요');
if (args.some((arg, i) => arg !== '--input' && arg !== '--apply' && args[i - 1] !== '--input')) throw new Error('지원하지 않는 옵션');
const inputStat = await stat(get('--input'));
if (!inputStat.isFile() || (inputStat.mode & 0o077) !== 0 || inputStat.uid !== process.getuid()) throw new Error('입력 파일은 현재 소유자만 읽을 수 있어야 합니다.');
const input = JSON.parse(await readFile(get('--input'), 'utf8'));
const require = createRequire(import.meta.url);
const admin = require('../firebase/kangsain-functions/functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'archive-pilates' });
try {
  const order = readImwebOrder(input.orderNo);
  const result = await admitInstructorOrderAttendees(admin.firestore(), order, input.attendees,
    { apply: args.includes('--apply'), actor: input.actor, basis: input.basis });
  console.log(JSON.stringify(result, null, 2));
} finally { await admin.app().delete(); }
