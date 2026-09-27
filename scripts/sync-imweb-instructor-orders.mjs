#!/usr/bin/env node
import { createRequire } from 'node:module';
import { syncImwebInstructorOrders } from './lib/imweb-instructor-orders.mjs';
const require = createRequire(import.meta.url);
const admin = require('../firebase/kangsain-functions/functions/node_modules/firebase-admin');
const args = process.argv.slice(2);
const orderNo = args.includes('--order-no') ? args[args.indexOf('--order-no') + 1] : '';
if (args.includes('--order-no') && !/^\d{15}$/.test(orderNo || '')) throw new Error('정확한 주문번호가 필요합니다.');
admin.initializeApp({ projectId: 'archive-pilates' });
try { console.log(JSON.stringify(await syncImwebInstructorOrders(admin.firestore(), { apply: args.includes('--apply'), force: args.includes('--force'), orderNo }), null, 2)); }
finally { await admin.app().delete(); }
