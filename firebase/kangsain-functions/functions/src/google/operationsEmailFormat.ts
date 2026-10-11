export function formatOperationsEmail(input: {
  subject: string;
  body: string;
  htmlBody?: string;
}): { body: string; htmlBody: string } {
  const body = input.body.replace(/^([ \t]*주체:[ \t]*)ARCHIVE IN(?=[ \t]+\/|[ \t]*$)/gm, "$1ARCHIVE CORE");
  return {
    body,
    htmlBody: input.htmlBody ?? defaultOperationsHtml(input.subject, body),
  };
}

function defaultOperationsHtml(subject: string, body: string): string {
  const content = body.split(/\r?\n/).map((line) => {
    if (!line.trim()) return "";
    const heading = /^(핵심|검증|주의|다음|상세|주요 항목):?$/.test(line.trim());
    return `<p style="margin:${heading ? "20px 0 6px" : "6px 0"};${heading ? "font-weight:700;" : ""}word-break:keep-all;overflow-wrap:anywhere">${linkifyText(line)}</p>`;
  }).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f4;color:#202020;font:16px/1.65 -apple-system,BlinkMacSystemFont,Arial,sans-serif;word-break:keep-all"><main style="max-width:640px;margin:auto;padding:24px;background:white"><p style="font-size:12px;color:#666;margin:0 0 12px">ARCHIVE PILATES · 운영 알림</p><h1 style="font-size:20px;line-height:1.5;margin:0 0 20px;overflow-wrap:anywhere">${escapeHtml(subject)}</h1>${content}</main></body></html>`;
}

function linkifyText(value: string): string {
  const parts: string[] = [];
  let offset = 0;
  for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const url = escapeHtml(match[0]);
    parts.push(escapeHtml(value.slice(offset, match.index)));
    parts.push(`<a href="${url}" style="color:#ae2424;word-break:keep-all;overflow-wrap:anywhere">${url}</a>`);
    offset = match.index! + match[0].length;
  }
  parts.push(escapeHtml(value.slice(offset)));
  return parts.join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}
