const ARCHIVE_PROJECT_ID = 'archive-pilates';
const ARCHIVE_FIREBASE_API_KEY = 'AIzaSyBhZrWWFgfBr-AIbESeOvD6qA2hHx4xNlQ';
const ARCHIVE_SURVEY_VIEW_BASE_URL = 'https://in.archivepilates.com/privateSurveyResponseView';

const SOURCE_SHEET_NAME = '설문지 응답 시트1';
const FIELD_HEADERS = {
  surveyId: '설문ID',
  accessToken: '접근토큰',
  detailUrl: '상세링크',
  status: 'ARCHIVE IN 처리상태',
  lastSyncedAt: 'ARCHIVE IN 전송시각',
  error: 'ARCHIVE IN 오류'
};

function onFormSubmit(e) {
  const sheet = e && e.range ? e.range.getSheet() : SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== SOURCE_SHEET_NAME) return;
  processPrivateSurveyRow_(sheet, e.range.getRow());
}

function installPrivateSurveyTrigger() {
  const spreadsheet = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'onFormSubmit')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(spreadsheet).onFormSubmit().create();
}

function processLatestPrivateSurveyRow() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SOURCE_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('처리할 설문 응답이 없습니다.');
  return processPrivateSurveyRow_(sheet, lastRow);
}

function processPrivateSurveyRow_(sheet, rowNumber) {
  const headerMap = ensureOutputHeaders_(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const answers = {};
  headers.forEach((header, index) => {
    if (!header) return;
    if (Object.values(FIELD_HEADERS).indexOf(header) >= 0) return;
    const key = String(header).trim();
    const value = String(values[index] || '').trim();
    if (answers[key] && !value) return;
    answers[key] = value || answers[key] || '';
  });

  const name = firstFilled_(answers, ['1. 성함을 입력해주세요']);
  const phone = normalizePhone_(firstFilled_(answers, ['2. 연락처를 입력해주세요']));
  if (!name || !phone) throw new Error('성함 또는 연락처가 비어 있습니다.');

  const existingId = cellValue_(sheet, rowNumber, headerMap[FIELD_HEADERS.surveyId]);
  const existingToken = cellValue_(sheet, rowNumber, headerMap[FIELD_HEADERS.accessToken]);
  const surveyId = existingId || buildSurveyId_(rowNumber, name);
  const accessToken = existingToken || buildAccessToken_();
  const detailUrl = `${ARCHIVE_SURVEY_VIEW_BASE_URL}?id=${encodeURIComponent(surveyId)}&token=${encodeURIComponent(accessToken)}`;
  const docKey = `${surveyId}-${accessToken}`;

  const payload = {
    docKey,
    responseId: surveyId,
    accessToken,
    spreadsheetId: SpreadsheetApp.getActive().getId(),
    sheetName: sheet.getName(),
    rowNumber,
    submittedAt: answers['타임스탬프'] || '',
    experienceType: answers['필라테스 운동경험이 있으신가요?'] || '',
    memberName: name,
    memberPhone: phone,
    answers,
    status: 'pending',
    createdAt: new Date()
  };

  writeFirestoreDocument_(`privateSurveyIntakes/${docKey}`, payload);

  sheet.getRange(rowNumber, headerMap[FIELD_HEADERS.surveyId]).setValue(surveyId);
  sheet.getRange(rowNumber, headerMap[FIELD_HEADERS.accessToken]).setValue(accessToken);
  sheet.getRange(rowNumber, headerMap[FIELD_HEADERS.detailUrl]).setValue(detailUrl);
  sheet.getRange(rowNumber, headerMap[FIELD_HEADERS.status]).setValue('전송완료');
  sheet.getRange(rowNumber, headerMap[FIELD_HEADERS.lastSyncedAt]).setValue(new Date());
  sheet.getRange(rowNumber, headerMap[FIELD_HEADERS.error]).clearContent();

  return { surveyId, accessToken, detailUrl };
}

function ensureOutputHeaders_(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  const headers = headerRange.getValues()[0];
  const map = {};
  headers.forEach((header, index) => {
    if (header) map[String(header)] = index + 1;
  });
  Object.values(FIELD_HEADERS).forEach((header) => {
    if (map[header]) return;
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue(header);
    map[header] = col;
  });
  return map;
}

function writeFirestoreDocument_(path, data) {
  const url = `https://firestore.googleapis.com/v1/projects/${ARCHIVE_PROJECT_ID}/databases/(default)/documents/${path}?key=${ARCHIVE_FIREBASE_API_KEY}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ fields: toFirestoreFields_(data) }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Firestore write failed ${code}: ${response.getContentText()}`);
  }
}

function toFirestoreFields_(obj) {
  const fields = {};
  Object.keys(obj).forEach((key) => {
    fields[key] = toFirestoreValue_(obj[key]);
  });
  return fields;
}

function toFirestoreValue_(value) {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue_) } };
  if (typeof value === 'object') return { mapValue: { fields: toFirestoreFields_(value) } };
  return { stringValue: String(value) };
}

function firstFilled_(answers, labels) {
  for (const label of labels) {
    const value = answers[label];
    if (value) return value;
  }
  return '';
}

function normalizePhone_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.indexOf('82') === 0) return `0${digits.slice(2)}`;
  return digits;
}

function buildSurveyId_(rowNumber, name) {
  const seed = `${Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd')}-${rowNumber}-${name || 'member'}`;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  const hex = bytes.map((byte) => (`0${(byte & 0xff).toString(16)}`).slice(-2)).join('').slice(0, 24);
  return `psr-${Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd')}-${rowNumber}-${hex}`;
}

function buildAccessToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function cellValue_(sheet, row, col) {
  return col ? String(sheet.getRange(row, col).getDisplayValue() || '').trim() : '';
}
