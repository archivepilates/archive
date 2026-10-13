import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash, createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { deliverAutomationReport, reportMessageId } from '../firebase/kangsain-functions/macmini-studiomate/automation-report-delivery.mjs';

const require = createRequire(import.meta.url);
const admin = require('../firebase/kangsain-functions/functions/node_modules/firebase-admin');
const keyPath = '/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json';
const channel = 'UCutXw1q-cPB2UbNLnnBMwpw';
const operator = 'home@archivepilates.com';
const endpoint = 'https://asia-northeast3-archive-pilates.cloudfunctions.net/approveYoutubeReel';

export const approvalEmail = (doc, token) => {
  const url = `${endpoint}#id=${encodeURIComponent(doc.id)}&token=${encodeURIComponent(token)}`;
  const preview = `https://www.youtube.com/shorts/${doc.videoId}`;
  const test = doc.isTest ? '테스트 · 실제 영상은 공개되지 않습니다.' : '현재 일부공개입니다. 승인된 영상만 하루 최대 한 편 공개합니다.';
  const title = doc.isTest ? '승인 버튼 테스트' : '릴스 공개 승인';
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#fafafa;color:#222;font:16px/1.7 -apple-system,BlinkMacSystemFont,sans-serif"><main style="max-width:620px;margin:auto;padding:28px 20px"><p style="font-size:13px;color:#777">주체: ARCHIVE PILATES / 판매영상 릴스 제작·승인</p><h1 style="font-size:24px;line-height:1.4">${title}</h1><p><strong>${escape(doc.title)}</strong></p><p>${test}</p><p><a href="${preview}" style="color:#222">YouTube에서 영상 확인</a></p><p><a href="${escape(url)}" style="display:inline-block;padding:14px 24px;background:#b5232a;color:white;font-weight:700;text-decoration:none;border-radius:4px">공개 승인</a></p><p style="font-size:14px;color:#666">버튼으로 열린 페이지에서 영상을 확인한 뒤 공개 승인을 눌러주세요. 메일 답장은 필요 없습니다. 링크는 7일 동안 유효합니다.</p><p style="font-size:14px;color:#666;white-space:pre-line">${escape(doc.reviewSummary || '')}</p><h2 style="font-size:18px">공개 예정 설명</h2><p style="font-size:14px;white-space:pre-line;overflow-wrap:anywhere">${escape(doc.contentSnapshot?.snippet?.description || '')}</p></main></body></html>`;
  return { html, body: `주체: ARCHIVE PILATES / 판매영상 릴스 제작·승인\n${doc.title}\n${test}\n영상 확인: ${preview}\n공개 승인: ${url}\n메일 답장은 필요 없습니다.\n${doc.reviewSummary || ''}` };
};

function escape(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function mail(subject, body, html, eventId, replyMessageId = '', status = '') {
  if (/[\r\n]/.test(subject)) throw new Error('Invalid mail header');
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const base64 = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  const input = `${base64({ alg: 'RS256', typ: 'JWT' })}.${base64({ iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now, sub: operator })}`;
  const signature = createSign('RSA-SHA256').update(input).sign(key.private_key, 'base64url');
  const auth = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${signature}` }) });
  const credential = await auth.json();
  if (!auth.ok || !credential.access_token) throw new Error('Gmail authorization failed');
  const gmailFetch = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${credential.access_token}`,
      'Content-Type': 'application/json', ...options.headers } });
    const value = await response.json();
    if (!response.ok) throw new Error(`Gmail request failed (${response.status})`);
    return value;
  };
  const profile = await gmailFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile');
  if (profile.emailAddress !== operator) throw new Error('Wrong Gmail account');
  const messageId = reportMessageId(eventId);
  const boundary = `reel-${eventId.slice(0, 24)}`;
  const encode = text => Buffer.from(text).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  const mime = [`From: ARCHIVE PILATES <${operator}>`, `To: ${operator}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, `Message-ID: <${messageId}>`,
    ...(replyMessageId ? [`In-Reply-To: <${replyMessageId}>`, `References: <${replyMessageId}>`] : []),
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encode(body),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encode(html), `--${boundary}--`].join('\r\n');
  const labels = await gmailFetch('https://gmail.googleapis.com/gmail/v1/users/me/labels');
  const names = ['릴스 보고', status || (subject.includes('[실패]') ? '자동화 실패' : subject.includes('[긴급]') ? '자동화 긴급' : '자동화 성공')];
  const labelIds = names.map(n => labels.labels?.find(l => l.name === n)?.id).filter(Boolean);
  return deliverAutomationReport({ gmailFetch, raw: Buffer.from(mime).toString('base64url'), messageId, labelIds });
}

async function run(action, input) {
  if (action === 'notice') {
    const eventId = createHash('sha256').update(input.eventKey).digest('hex');
    if (input.replyMessageId && !/^automation-[a-f0-9]{64}@archivepilates\.com$/.test(input.replyMessageId)) throw new Error('Invalid reply header');
    return mail(input.subject, input.body, `<p style="white-space:pre-line;font:16px/1.7 sans-serif">${escape(input.body)}</p>`, eventId, input.replyMessageId, input.statusLabel);
  }
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(key), projectId: 'archive-pilates' });
  const collection = admin.firestore().collection('youtubeReelApprovals');
  if (action === 'list') {
    const docs = await collection.where('needsWorker', '==', true).limit(50).get();
    return docs.docs.map(d => d.data()).filter(d => d.isTest === false && ['approved', 'published'].includes(d.status));
  }
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(input.id || '')) throw new Error('Invalid approval ID');
  const ref = collection.doc(input.id);
  if (action === 'get') return (await ref.get()).data() || null;
  if (action === 'finish-notice') {
    if (typeof input.messageId !== 'string' || !input.messageId.trim()) throw new Error('Notice receipt missing');
    await admin.firestore().runTransaction(async tx => {
      const doc = (await tx.get(ref)).data();
      if (!doc || doc.isTest || doc.contentHash !== input.contentHash || doc.status !== 'published') throw new Error('Public notice scope mismatch');
      tx.update(ref, { needsWorker: false, publicNoticeMessageId: input.messageId });
    });
    return { ok: true };
  }
  if (action === 'complete') {
    await admin.firestore().runTransaction(async tx => {
      const doc = (await tx.get(ref)).data();
      if (!doc || doc.isTest || doc.contentHash !== input.contentHash || doc.videoId !== input.videoId) throw new Error('Approval scope mismatch');
      if (doc.status === 'published') return;
      if (doc.status !== 'approved') throw new Error('Approval not confirmed');
      tx.update(ref, { status: 'published', publishedAt: Date.now(), publicDateKst: input.publicDateKst });
    });
    return { ok: true };
  }
  if (action !== 'request') throw new Error('Unknown action');
  if (input.channelId !== channel || !/^[\w-]{11}$/.test(input.videoId) || typeof input.isTest !== 'boolean') throw new Error('Invalid channel or video');
  for (const field of ['fileSha256', 'contentHash', 'tokenHash']) if (!/^[a-f0-9]{64}$/.test(input[field] || '')) throw new Error('Invalid approval hash');
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token || '') || createHash('sha256').update(input.token).digest('hex') !== input.tokenHash) throw new Error('Token hash mismatch');
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now() || input.expiresAt > Date.now() + 8 * 86400000) throw new Error('Invalid expiration');
  const { token, ...doc } = input;
  doc.schemaVersion = 1;
  doc.status = 'pending';
  doc.needsWorker = false;
  doc.createdAt = Date.now();
  doc.approverEmail = operator;
  await admin.firestore().runTransaction(async tx => {
    const existing = (await tx.get(ref)).data();
    if (existing) {
      for (const key of ['videoId', 'channelId', 'fileSha256', 'contentHash', 'tokenHash', 'isTest'])
        if (existing[key] !== doc[key]) throw new Error('Existing approval does not match');
      return;
    }
    tx.create(ref, doc);
  });
  const existing = (await ref.get()).data();
  if (existing.requestEmail?.messageId) return { id: input.id, ...existing.requestEmail };
  const content = approvalEmail(existing, token);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const eventId = createHash('sha256').update(`reel-approval/${input.id}/v1`).digest('hex');
  const requestSubject = `[릴스][긴급] ${input.isTest ? '승인 버튼 테스트' : '공개 승인 요청'} · ${date}`;
  const receipt = await mail(requestSubject, content.body, content.html, eventId);
  await ref.update({ requestEmail: receipt, requestSubject, requestMessageId: reportMessageId(eventId), requestEmailSentAt: Date.now() });
  return { id: input.id, ...receipt };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try { console.log(JSON.stringify(await run(process.argv[2], JSON.parse(Buffer.concat(chunks).toString() || '{}')))); }
  catch { console.error('Reel approval store operation failed. No tokens or private response logged.'); process.exitCode = 1; }
}
