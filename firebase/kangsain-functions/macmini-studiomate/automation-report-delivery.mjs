export function reportMessageId(eventId) {
  if (!eventId) return '';
  if (!/^[a-f0-9]{64}$/.test(eventId)) throw new Error('Invalid automation report event ID');
  return `automation-${eventId}@archivepilates.com`;
}

export async function deliverAutomationReport({ gmailFetch, raw, messageId = '', labelId, reconcileOnly = false }) {
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  let sent;
  if (messageId) {
    const prior = await gmailFetch(`${base}?q=${encodeURIComponent(`in:sent rfc822msgid:${messageId}`)}&maxResults=1`);
    if (prior.messages?.length) sent = prior.messages[0];
  }
  if (!sent && reconcileOnly) return { notFound: true };
  if (!sent) sent = await gmailFetch(`${base}/send`, { method: 'POST', body: JSON.stringify({ raw }) });
  if (!sent.id) throw new Error('Automation report delivery unconfirmed');
  let labelApplied = false;
  if (labelId) {
    try {
      await gmailFetch(`${base}/${sent.id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: [labelId] }) });
      labelApplied = true;
    } catch { /* Delivery already succeeded; a label failure must not cause a resend. */ }
  }
  return { messageId: sent.id, threadId: sent.threadId, labelApplied };
}
