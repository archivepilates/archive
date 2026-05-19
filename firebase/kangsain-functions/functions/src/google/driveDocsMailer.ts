import { DelegatedGoogleClient } from "./delegatedGoogleClient";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const DOCS_SCOPE = "https://www.googleapis.com/auth/documents";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const REPORT_FOLDER_NAME = "알림톡";
const OPERATOR_EMAIL = "home@archivepilates.com";

interface DriveFile {
  id: string;
  name?: string;
  webViewLink?: string;
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
  to?: string;
}): Promise<void> {
  const client = new DelegatedGoogleClient([GMAIL_SEND_SCOPE]);
  const to = input.to || OPERATOR_EMAIL;
  const raw = Buffer.from(
    [
      `From: ARCHIVE IN <${OPERATOR_EMAIL}>`,
      `To: ${to}`,
      `Subject: ${encodeMimeHeader(input.subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.body,
    ].join("\r\n"),
  ).toString("base64url");
  await client.request("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
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
