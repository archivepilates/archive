import { logger } from "firebase-functions";
import { DelegatedGoogleClient } from "./delegatedGoogleClient";
import { formatOperationsEmail } from "./operationsEmailFormat";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const DOCS_SCOPE = "https://www.googleapis.com/auth/documents";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const REPORT_FOLDER_NAME = "알림톡";
const OPERATOR_EMAIL = "home@archivepilates.com";
const ALIMTALK_REPORT_LABEL_NAME = "알림톡 보고";
const AUTOMATION_STATUS_LABELS = {
  success: "자동화 성공",
  failure: "자동화 실패",
  urgent: "자동화 긴급",
  attention: "자동화 확인필요",
} as const;

export type AutomationEmailStatus = keyof typeof AUTOMATION_STATUS_LABELS;

export type OperationsEmailInput = {
  subject: string;
  body: string;
  htmlBody?: string;
  to?: string;
  status?: AutomationEmailStatus;
  domainLabel: string;
  labelNames?: string[];
};

interface DriveFile {
  id: string;
  name?: string;
  webViewLink?: string;
}

interface GmailMessage {
  id: string;
}

interface GmailLabel {
  id: string;
  name: string;
}

export async function createAlimtalkLogDocument(input: {
  title: string;
  body: string;
}): Promise<{ documentId: string; url: string }> {
  const client = new DelegatedGoogleClient([DRIVE_SCOPE, DOCS_SCOPE]);
  const folderId = await findOrCreateFolder(client, REPORT_FOLDER_NAME);
  const file = await client.request<DriveFile>("https://www.googleapis.com/drive/v3/files?fields=id,webViewLink", {
    method: "POST",
    body: JSON.stringify({
      name: input.title,
      mimeType: "application/vnd.google-apps.document",
      parents: [folderId],
    }),
  });
  await client.request(`https://docs.googleapis.com/v1/documents/${file.id}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: input.body,
          },
        },
      ],
    }),
  });
  return {
    documentId: file.id,
    url: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`,
  };
}

export async function sendAlimtalkLogEmail(input: {
  subject: string;
  body: string;
  htmlBody?: string;
  to?: string;
  status?: AutomationEmailStatus;
  labelNames?: string[];
}): Promise<void> {
  await sendOperationsEmail({
    ...input,
    domainLabel: ALIMTALK_REPORT_LABEL_NAME,
  });
}

export async function sendOperationsEmail(input: OperationsEmailInput): Promise<void> {
  const to = input.to || OPERATOR_EMAIL;
  const boundary = `archive-in-${Date.now().toString(36)}`;
  for (const value of [OPERATOR_EMAIL, to, input.subject, boundary]) {
    if (/[\r\n]/.test(value)) throw new Error("Invalid operations email header.");
  }
  const formatted = formatOperationsEmail(input);
  const content = [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(formatted.body),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(formatted.htmlBody),
    "",
    `--${boundary}--`,
  ].join("\r\n");
  const raw = Buffer.from(
    [
      `From: ARCHIVE CORE <${OPERATOR_EMAIL}>`,
      `To: ${to}`,
      `Subject: ${encodeMimeHeader(input.subject)}`,
      "MIME-Version: 1.0",
      content,
    ].join("\r\n"),
  ).toString("base64url");
  const client = new DelegatedGoogleClient([GMAIL_SEND_SCOPE, GMAIL_MODIFY_SCOPE]);
  const sent = await client.request<GmailMessage>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
  if (typeof sent?.id !== "string" || !sent.id.trim()) {
    throw new Error("Gmail send response is missing a message id.");
  }
  try {
    await applyGmailLabels(client, sent.id, reportLabelNames(input.domainLabel, input.status, input.labelNames));
  } catch {
    // The message is already sent; label failure must not trigger a resend.
    logger.warn("Operations email sent; Gmail label application failed. Do not resend.", {
      sendConfirmed: true,
    });
  }
}

function reportLabelNames(domainLabel: string, status?: AutomationEmailStatus, labelNames: string[] = []): string[] {
  return uniqueLabels([domainLabel, status ? AUTOMATION_STATUS_LABELS[status] : "", ...labelNames]);
}

function uniqueLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
}

async function applyGmailLabels(client: DelegatedGoogleClient, messageId: string, labelNames: string[]): Promise<void> {
  const labelIds = await Promise.all(labelNames.map((labelName) => findOrCreateGmailLabel(client, labelName)));
  if (!labelIds.length) return;
  await client.request(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: labelIds }),
  });
}

async function findOrCreateGmailLabel(client: DelegatedGoogleClient, name: string): Promise<string> {
  const labels = await client.request<{ labels?: GmailLabel[] }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/labels",
  );
  const existing = labels.labels?.find((label) => label.name === name);
  if (existing?.id) return existing.id;
  const created = await client.request<GmailLabel>("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  return created.id;
}

async function findOrCreateFolder(client: DelegatedGoogleClient, name: string): Promise<string> {
  const query = [
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${escapeDriveQuery(name)}'`,
    "trashed = false",
  ].join(" and ");
  const found = await client.request<{ files?: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
  );
  if (found.files?.[0]?.id) return found.files[0].id;
  const created = await client.request<DriveFile>("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  return created.id;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function encodeMimeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function encodeMimeBody(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
}
