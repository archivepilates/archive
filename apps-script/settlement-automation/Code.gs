const CONFIG = {
  RAW_FOLDER_NAME: '수업매출원본데이터',
  BACKUP_FOLDER_NAME: '월별정산백업',
  DASHBOARD_SHEET_NAME: '시트1',
  DASHBOARD_EXPORT_SHEET_NAME: '대시보드_EXPORT',
  PRICE_FILE_NAME: '기간권 차감금액표',
  RATE_FILE_NAME: '아카이브 강사 보수기준표',
  SUMMARY_WEBHOOK_URL: '', // 카카오/Make/Zapier 웹훅 URL 입력
  DB_SYNC_WEBAPP_URL: '',
DB_SYNC_SECRET_KEY: 'ARCHIVE_SYNC_2026',
  VAT_DIVISOR: 1.1,
  WITHHOLDING_RATE: 0.033,
  DEFAULT_PRIVATE_RATE: 0.45,
  DEFAULT_LESSON_RATE: 0.55,
  GROUP_CAPACITY: 5,
  DEFAULT_GROUP_RATES: [15000, 25000, 25000, 30000, 32000, 35000, 35000, 35000, 35000, 35000, 35000]
};

/**
 * 준비 사항
 * 1) 자동화 스프레드시트는 '아카이브 정산' 폴더 안에 있어야 함
 * 2) 같은 폴더 안에 '수업매출원본데이터' 폴더가 있어야 함
 * 3) 같은 폴더 안에 아래 기준 파일이 있어야 함
 *    - 기간권 차감금액표
 *    - 아카이브 강사 보수기준표
 * 4) Apps Script > 서비스 > Drive API 고급 서비스 활성화 필요 (중복 추가 금지)
 * 5) 버튼 스크립트 할당: runArchiveMonthlyAutomation
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('아카이브 정산')
    .addItem('월간 자동화 실행', 'runArchiveMonthlyAutomation')
    .addItem('대시보드 다시 만들기', 'setupDashboardSheet')
    .addItem('대시보드 새로고침', 'refreshDashboardLinks')
    .addItem('대시보드 EXPORT 재생성', 'rebuildLatestDashboardExport')
    .addToUi();
}

function setupDashboardSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, CONFIG.DASHBOARD_SHEET_NAME);
  clearOtherSheets_(ss, CONFIG.DASHBOARD_SHEET_NAME);
  sheet.clear();

  sheet.getRange('A1').setValue('아카이브 월간 정산 자동화 대시보드')
    .setFontSize(16)
    .setFontWeight('bold');

  const guide = [
    ['1. 수업매출원본데이터 폴더에 월별 엑셀 파일 업로드'],
    ['2. 시트 위 버튼 또는 상단 메뉴 > 아카이브 정산 > 월간 자동화 실행'],
    ['3. 결과 파일은 월별정산백업 폴더에 월별로 저장'],
    ['4. 아래 목록에서 강사정산 / 리포트 링크 클릭'],
    ['5. 버튼에는 스크립트 할당: runArchiveMonthlyAutomation']
  ];

  sheet.getRange(3, 1, guide.length, 1).setValues(guide);
  sheet.getRange('A3:A7').setFontSize(11);

  sheet.getRange('A9').setValue('버튼 만드는 방법')
    .setFontWeight('bold')
    .setBackground('#D9EAD3');
  sheet.getRange('A10').setValue('삽입 > 드로잉(또는 이미지) > 버튼 만들기 > 우클릭 > 스크립트 할당 > runArchiveMonthlyAutomation');

  sheet.getRange('A12:G12').setValues([['월', '원본파일명', '원본 수정일', '백업상태', '강사정산', '리포트', '백업파일']])
    .setFontWeight('bold')
    .setBackground('#E8F0FE')
    .setHorizontalAlignment('center');

  resizeSheetToFit_(sheet, 30, 7);
  applySheetColumnWidths_(sheet);
  sheet.setFrozenRows(12);

  refreshDashboardLinks();
}

function runArchiveMonthlyAutomation() {
  const result = processAllRawFiles_();

  try {
    var syncResult = triggerArchiveDbSync_();

    SpreadsheetApp.getUi().alert(
      '자동화 완료\n' +
      '- 대상월: ' + result.targetMonthKey + '\n' +
      '- 신규/갱신: ' + result.processedCount + '건\n' +
      '- 건너뜀: ' + result.skippedCount + '건\n' +
      '- 정산 DB: ' + (syncResult.skipped ? '별도 동기화에서 처리' : '자동 갱신 완료')
    );

  } catch (err) {
    SpreadsheetApp.getUi().alert(
      '정산 자동화는 완료되었지만, 정산 DB 자동 갱신은 실패했습니다.\n\n' +
      '대상월: ' + result.targetMonthKey + '\n' +
      '신규/갱신: ' + result.processedCount + '건\n' +
      '건너뜀: ' + result.skippedCount + '건\n\n' +
      '오류: ' + err.message
    );
  }
}

function refreshDashboardLinks() {
  const ctx = getContext_();
  const sheet = getOrCreateSheet_(ctx.ss, CONFIG.DASHBOARD_SHEET_NAME);
  clearOtherSheets_(ctx.ss, CONFIG.DASHBOARD_SHEET_NAME);

  const rawFiles = getMonthlyRawFiles_(ctx.rawFolder);
  const backupFolder = getOrCreateFolder_(ctx.rootFolder, CONFIG.BACKUP_FOLDER_NAME);
  const backupFiles = listBackupFilesByMonth_(backupFolder);

  const startRow = 13;
  const rows = rawFiles.map(item => {
    const backup = backupFiles[item.monthKey] || null;
    const status = backup ? '생성완료' : '미생성';

    return [
      formatMonthLabel_(item.monthKey),
      item.file.getName(),
      Utilities.formatDate(item.file.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
      status,
      backup ? `=HYPERLINK("${backup.url}#gid=${backup.payrollSheetId || 0}", "강사정산")` : '',
      backup ? `=HYPERLINK("${backup.url}#gid=${backup.reportSheetId || 0}", "리포트")` : '',
      backup ? `=HYPERLINK("${backup.url}", "${backup.name}")` : ''
    ];
  });

  const requiredRows = Math.max(startRow - 1 + rows.length, 13);
  resizeSheetToFit_(sheet, requiredRows, 7);

  sheet.getRange('A12:G12').setValues([['월', '원본파일명', '원본 수정일', '백업상태', '강사정산', '리포트', '백업파일']])
    .setFontWeight('bold')
    .setBackground('#E8F0FE')
    .setHorizontalAlignment('center');

  if (rows.length) {
    sheet.getRange(startRow, 1, rows.length, 7).setValues(rows);
  }

  applySheetColumnWidths_(sheet);
}

function rebuildLatestDashboardExport() {
  const ctx = getContext_();
  const backupFolder = getOrCreateFolder_(ctx.rootFolder, CONFIG.BACKUP_FOLDER_NAME);
  const backupFiles = listBackupFilesByMonth_(backupFolder);
  const targetMonthKey = getPreviousMonthKey_();
  const backup = backupFiles[targetMonthKey];
  if (!backup) {
    throw new Error(`월별정산백업에서 ${targetMonthKey} 백업 파일을 찾을 수 없습니다.`);
  }

  const ss = SpreadsheetApp.openById(backup.id);
  const payrollRows = readPayrollRowsFromSheet_(ss);
  const report = readMonthlyReportFromSheet_(ss, payrollRows);
  writeDashboardExportSheet_(ss, targetMonthKey, payrollRows, report);
  SpreadsheetApp.getUi().alert(`대시보드_EXPORT 재생성 완료\\n대상월: ${targetMonthKey}`);
}

function processAllRawFiles_() {
  const ctx = getContext_();
  const refs = loadReferenceTables_(ctx.rootFolder);
  const backupFolder = getOrCreateFolder_(ctx.rootFolder, CONFIG.BACKUP_FOLDER_NAME);

  const targetMonthKey = getPreviousMonthKey_();
  const allRawFiles = getMonthlyRawFiles_(ctx.rawFolder);
  const rawFiles = allRawFiles.filter(item => item.monthKey === targetMonthKey);
  if (!rawFiles.length) {
    throw new Error(`${CONFIG.RAW_FOLDER_NAME} 폴더에 ${targetMonthKey} 월별 스프레드시트 파일이 없습니다.`);
  }

  const backupFiles = listBackupFilesByMonth_(backupFolder);
  let processedCount = 0;
  let skippedCount = 0;

  rawFiles.forEach(item => {
    const rawUpdated = item.file.getLastUpdated().getTime();
    const existing = backupFiles[item.monthKey];
    const backupUpdated = existing ? existing.updatedTime : 0;

    if (existing && backupUpdated >= rawUpdated) {
      ensureDashboardExportForBackup_(existing.id, item.monthKey);
      skippedCount += 1;
      return;
    }
     Utilities.sleep(500); // ← 추가: 파일 간 0.5초 간격

    const rawRows = loadWorkbookRowsFromFile_(item.file, ctx.rootFolder);
    const auxRows = buildAuxRows_(rawRows, refs);
    const payroll = buildPayroll_(auxRows, refs);
    const report = buildMonthlyReport_(auxRows, payroll.rows);

    const backupFile = createOrReplaceMonthlyBackupFile_(backupFolder, item.monthKey);
    const backupSs = SpreadsheetApp.openById(backupFile.getId());

    writeAuxSheet_(backupSs, auxRows);
    writePayrollSheet_(backupSs, payroll.rows);
    writeReportSheet_(backupSs, report);
    writeDashboardExportSheet_(backupSs, item.monthKey, payroll.rows, report);
    removeDefaultSheetIfUnused_(backupSs);

    processedCount += 1;
  });

  refreshDashboardLinks();

  const summaryText = buildBulkSummaryMessage_(targetMonthKey, rawFiles.length, processedCount, skippedCount);
  sendWebhookSummary_(summaryText);

  return { targetMonthKey, processedCount, skippedCount };
}

function getPreviousMonthKey_() {
  const now = new Date();
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return Utilities.formatDate(previousMonth, Session.getScriptTimeZone(), 'yyyy-MM');
}

function getContext_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  const parents = file.getParents();
  if (!parents.hasNext()) throw new Error('현재 스프레드시트의 상위 폴더를 찾을 수 없습니다.');

  const rootFolder = parents.next();
  const rawFolderIter = rootFolder.getFoldersByName(CONFIG.RAW_FOLDER_NAME);
  if (!rawFolderIter.hasNext()) {
    throw new Error(`원본 폴더를 찾을 수 없습니다: ${CONFIG.RAW_FOLDER_NAME}`);
  }

  return {
    ss,
    rootFolder,
    rawFolder: rawFolderIter.next()
  };
}

function cleanupDuplicateRawFolders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  const parents = file.getParents();
  if (!parents.hasNext()) throw new Error('현재 스프레드시트의 상위 폴더를 찾을 수 없습니다.');

  const rootFolder = parents.next();
  const result = [
    trashLegacyFolderIfDuplicated_(rootFolder, '수업원본데이터', '수업매출원본데이터'),
    trashLegacyFolderIfDuplicated_(rootFolder, '수강권원본데이터', '수강권매출원본데이터')
  ];

  Logger.log(JSON.stringify(result));
  return result;
}

function trashLegacyFolderIfDuplicated_(rootFolder, legacyFolderName, canonicalFolderName) {
  const legacyIter = rootFolder.getFoldersByName(legacyFolderName);
  if (!legacyIter.hasNext()) {
    return { legacyFolderName, canonicalFolderName, status: 'legacy_not_found' };
  }

  const canonicalIter = rootFolder.getFoldersByName(canonicalFolderName);
  if (!canonicalIter.hasNext()) {
    throw new Error(`기준 원본 폴더를 찾을 수 없습니다: ${canonicalFolderName}`);
  }

  const legacyFolder = legacyIter.next();
  const canonicalFolder = canonicalIter.next();
  const canonicalNames = listFileNameSetInFolder_(canonicalFolder);
  const legacyNames = listFileNamesInFolder_(legacyFolder);
  const missingNames = legacyNames.filter(name => !canonicalNames[name]);

  if (missingNames.length) {
    throw new Error(`${legacyFolderName} 안에 기준 폴더에 없는 파일이 있습니다: ${missingNames.join(', ')}`);
  }

  legacyFolder.setTrashed(true);
  return {
    legacyFolderName,
    canonicalFolderName,
    status: 'trashed',
    fileCount: legacyNames.length
  };
}

function listFileNamesInFolder_(folder) {
  const files = folder.getFiles();
  const names = [];
  while (files.hasNext()) {
    names.push(String(files.next().getName() || ''));
  }
  return names;
}

function listFileNameSetInFolder_(folder) {
  const names = {};
  listFileNamesInFolder_(folder).forEach(name => {
    names[name] = true;
  });
  return names;
}

function clearOtherSheets_(ss, keepName) {
  ss.getSheets().forEach(sheet => {
    if (sheet.getName() !== keepName) ss.deleteSheet(sheet);
  });
}

function listRawSpreadsheetFiles_(folder) {
  const files = folder.getFiles();
  const items = [];

  while (files.hasNext()) {
    const file = files.next();
    const name = String(file.getName() || '');
    if (name.startsWith('[TMP]')) continue;
    if (!isSpreadsheetFile_(file)) continue;
    items.push(file);
  }

  items.sort((a, b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());
  return items;
}

function getMonthlyRawFiles_(folder) {
  const files = listRawSpreadsheetFiles_(folder);
  const byMonth = {};

  files.forEach(file => {
    const name = String(file.getName() || '');
    if (name.startsWith('[TMP]')) return;

    const monthKey = extractMonthKeyFromFileName_(name);
    if (!monthKey) return;

    if (!byMonth[monthKey]) {
      byMonth[monthKey] = { file, monthKey };
      return;
    }

    const currentTime = file.getLastUpdated().getTime();
    const savedTime = byMonth[monthKey].file.getLastUpdated().getTime();

    if (currentTime > savedTime) {
      byMonth[monthKey] = { file, monthKey };
    }
  });

  return Object.values(byMonth).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

function extractMonthKeyFromFileName_(fileName) {
  const text = String(fileName || '');
  const m = text.match(/(20\d{2})-(\d{2})-\d{2}~(20\d{2})-(\d{2})-\d{2}/);
  if (m) return `${m[1]}-${m[2]}`;

  const m2 = text.match(/(20\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}`;

  return '';
}

function formatMonthLabel_(monthKey) {
  const parts = String(monthKey || '').split('-');
  if (parts.length !== 2) return monthKey;
  return `${Number(parts[0])}년${Number(parts[1])}월`;
}

function isSpreadsheetFile_(file) {
  const name = String(file.getName() || '').toLowerCase();
  const mime = String(file.getMimeType() || '').toLowerCase();

  return name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    mime.indexOf('excel') > -1 ||
    mime.indexOf('spreadsheetml') > -1 ||
    mime === MimeType.GOOGLE_SHEETS ||
    mime === 'application/vnd.google-apps.spreadsheet';
}

function isGoogleSheetsFile_(file) {
  const mime = String(file.getMimeType() || '').toLowerCase();
  return mime === MimeType.GOOGLE_SHEETS ||
    mime === 'application/vnd.google-apps.spreadsheet';
}

function loadWorkbookRowsFromFile_(file, tempParentFolder) {
  const mime = String(file.getMimeType() || '').toLowerCase();
  let tempSpreadsheetId = null;
  let targetSpreadsheetId = null;

  try {
    if (mime === MimeType.GOOGLE_SHEETS || mime === 'application/vnd.google-apps.spreadsheet') {
      targetSpreadsheetId = file.getId();
    } else {
      targetSpreadsheetId = convertExcelToGoogleSheet_(file, tempParentFolder);
      tempSpreadsheetId = targetSpreadsheetId;
    }

    const tempSs = SpreadsheetApp.openById(targetSpreadsheetId);
    const firstSheet = tempSs.getSheets()[0];
    const values = firstSheet.getDataRange().getValues();
    if (values.length < 2) return [];

    const headers = values[0].map(v => String(v || '').trim());
    return values.slice(1)
      .map(row => mapRawRow_(headers, row, file.getName()))
      .filter(row => row.instructorName);
  } finally {
    if (tempSpreadsheetId) {
      DriveApp.getFileById(tempSpreadsheetId).setTrashed(true);
    }
  }
}

function convertExcelToGoogleSheet_(file, parentFolder) {
  return driveFileCopyWithRetry_(file.getId(), `[TMP] ${file.getName()} ${Date.now()}`);
}


function moveFileToFolder_(file, targetFolder) {
  targetFolder.addFile(file);
  const parents = file.getParents();
  while (parents.hasNext()) {
    const p = parents.next();
    if (p.getId() !== targetFolder.getId()) p.removeFile(file);
  }
}


function getOrCreateFolder_(parentFolder, folderName) {
  const iter = parentFolder.getFoldersByName(folderName);
  return iter.hasNext() ? iter.next() : parentFolder.createFolder(folderName);
}

function createOrReplaceMonthlyBackupFile_(backupFolder, monthKey) {
  const fileName = `아카이브 정산_${monthKey}`;
  const files = backupFolder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const existingMonthKey =
      extractMonthKeyFromFileName_(file.getName().replace('아카이브 정산_', '')) ||
      extractMonthKeyFromFileName_(file.getName());
    if (existingMonthKey === monthKey) {
      file.setTrashed(true);
    }
  }

  const newSs = SpreadsheetApp.create(fileName);
  const newFile = DriveApp.getFileById(newSs.getId());
  moveFileToFolder_(newFile, backupFolder);
  return newFile;
}




function listBackupFilesByMonth_(backupFolder) {
  const files = backupFolder.getFiles();
  const result = {};

  while (files.hasNext()) {
    const file = files.next();
    if (!isGoogleSheetsFile_(file)) continue;

    const monthKey =
      extractMonthKeyFromFileName_(file.getName().replace('아카이브 정산_', '')) ||
      extractMonthKeyFromFileName_(file.getName());

    if (!monthKey) continue;

    let reportSheetId = 0;
    let payrollSheetId = 0;

    try {
      const ss = SpreadsheetApp.openById(file.getId());
      const reportSheet = ss.getSheetByName('월간리포트');
      const payrollSheet = ss.getSheetByName('정산대장');
      if (reportSheet) reportSheetId = reportSheet.getSheetId();
      if (payrollSheet) payrollSheetId = payrollSheet.getSheetId();
    } catch (e) {}

    result[monthKey] = {
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      reportSheetId,
      payrollSheetId,
      updatedTime: file.getLastUpdated().getTime()
    };
  }

  return result;
}

function mapRawRow_(headers, row, sourceFileName) {
  const h = getHeaderIndexMap_(headers);

  const classType = getCellByAliases_(row, h, ['수업', '수업구분']);
  const dateValue = getCellByAliases_(row, h, ['날짜', '수업일자']);
  const startTime = getCellByAliases_(row, h, ['수업시작', '시간']);
  const weekday = getCellByAliases_(row, h, ['요일']);
  const memberName = getCellByAliases_(row, h, ['회원명', '이름']);
  const ticketName = getCellByAliases_(row, h, ['수강권명']);
  const revenue = getCellByAliases_(row, h, ['차감 금액', '차감금액']);
  const instructorName = getCellByAliases_(row, h, ['수업 강사', '강사']);
  const attendance = getCellByAliases_(row, h, ['출결']);

  const classDate = normalizeDate_(dateValue);
  const classTime = normalizeTime_(startTime);
  const originalType = String(classType || '').trim();
  const finalType = String(ticketName || '').includes('강사레슨') ? '강사레슨' : originalType;
  const sessionKey = `${classDate}_${classTime}_${String(instructorName || '').trim()}`;

  return {
    sourceFileName,
    classDate,
    weekday: String(weekday || '').trim() || getWeekdayKorean_(classDate),
    classTime,
    memberName: String(memberName || '').trim(),
    instructorName: String(instructorName || '').trim(),
    originalType,
    finalType,
    ticketName: String(ticketName || '').trim(),
    attendance: String(attendance || '').trim(),
    revenue: toNumber_(revenue),
    sessionKey
  };
}

function loadReferenceTables_(rootFolder) {
  const priceData = getExternalSheetData_(rootFolder, CONFIG.PRICE_FILE_NAME);
  const groupRates = getExternalSheetData_(rootFolder, CONFIG.RATE_FILE_NAME, '그룹');
  const privateRates = getExternalSheetData_(rootFolder, CONFIG.RATE_FILE_NAME, '프라이빗');
  const lessonRates = getExternalSheetData_(rootFolder, CONFIG.RATE_FILE_NAME, '강사레슨');

  const priceMap = {};
  priceData.slice(1).forEach(row => {
    const ticketName = String(row[1] || '').trim();
    if (ticketName) priceMap[ticketName] = toNumber_(row[2]);
  });

  const groupMap = {};
  groupRates.slice(1).forEach(row => {
    const name = String(row[0] || '').trim();
    if (name) groupMap[name] = row.slice(1).map(toNumber_);
  });

  const privateMap = {};
  privateRates.slice(1).forEach(row => {
    const name = String(row[0] || '').trim();
    if (name) privateMap[name] = toNumber_(row[1]);
  });

  const lessonMap = {};
  lessonRates.slice(1).forEach(row => {
    const name = String(row[0] || '').trim();
    if (name) lessonMap[name] = toNumber_(row[1]);
  });

  return { priceMap, groupMap, privateMap, lessonMap };
}

function getExternalSheetData_(folder, fileName, sheetName) {
  const files = folder.getFilesByName(fileName);
  if (!files.hasNext()) throw new Error(`기준 파일을 찾을 수 없습니다: ${fileName}`);

  const file = files.next();
  const mime = String(file.getMimeType() || '').toLowerCase();
  const isGoogleSheets = mime === MimeType.GOOGLE_SHEETS ||
    mime === 'application/vnd.google-apps.spreadsheet';

  let tempId = null;
  try {
    const ssId = isGoogleSheets
      ? file.getId()
      : (tempId = driveFileCopyWithRetry_(file.getId(), `[TMP] ${file.getName()} ${Date.now()}`));

    const ss = SpreadsheetApp.openById(ssId);
    const sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
    if (!sheet) throw new Error(`시트를 찾을 수 없습니다: ${fileName} / ${sheetName}`);
    return sheet.getDataRange().getValues();
  } finally {
    if (tempId) try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) {}
  }
}
function driveFileCopyWithRetry_(fileId, title) {
  let delay = 1000;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const copied = Drive.Files.copy(
        { title: title, mimeType: MimeType.GOOGLE_SHEETS },
        fileId
      );
      Utilities.sleep(3000);
      return copied.id;
    } catch (e) {
      if (attempt === 4) throw e;
      Utilities.sleep(delay + Math.floor(Math.random() * 500));
      delay *= 2;
    }
  }
}



function buildAuxRows_(rawRows, refs) {
  return rawRows.map(row => {
    const attendanceFlag = row.attendance === '출석' ? 1 : 0;
    const settlementCount = getSettlementCount_(row.attendance);
    const baseRevenue = row.revenue > 0 ? row.revenue : (refs.priceMap[row.ticketName] || 0);
    const settlementRevenue = baseRevenue * settlementCount;

    let appliedRate = 0;
    let linePay = 0;

    if (row.finalType === '프라이빗') {
      appliedRate = refs.privateMap[row.instructorName] || CONFIG.DEFAULT_PRIVATE_RATE;
      linePay = settlementCount ? (settlementRevenue / CONFIG.VAT_DIVISOR) * appliedRate : 0;
    } else if (row.finalType === '강사레슨') {
      appliedRate = refs.lessonMap[row.instructorName] || CONFIG.DEFAULT_LESSON_RATE;
      linePay = settlementCount ? (settlementRevenue / CONFIG.VAT_DIVISOR) * appliedRate : 0;
    }

    return {
      ...row,
      attendanceFlag,
      settlementCount,
      settlementRevenue,
      appliedRate,
      linePay: Math.round(linePay)
    };
  });
}

function writeAuxSheet_(ss, auxRows) {
  const sheet = resetSheet_(ss, '정산보조');

  const header = [[
    '원본파일명', '수업일자', '요일', '수업시간', '회원명', '강사명',
    '원래수업구분', '최종수업구분', '수강권명', '출결', '차감금액',
    '세션키', '정산대상', '정산매출', '적용요율', '행보수'
  ]];

  const values = auxRows.map(row => [
    row.sourceFileName, row.classDate, row.weekday, row.classTime, row.memberName, row.instructorName,
    row.originalType, row.finalType, row.ticketName, row.attendance, row.revenue,
    row.sessionKey, row.settlementCount, row.settlementRevenue, row.appliedRate, row.linePay
  ]);

  const totalRows = 1 + values.length;
  resizeSheetToFit_(sheet, totalRows, header[0].length);

  sheet.getRange(1, 1, 1, header[0].length).setValues(header)
    .setFontWeight('bold')
    .setBackground('#E8F0FE')
    .setHorizontalAlignment('center');

  if (values.length) {
    sheet.getRange(2, 1, values.length, header[0].length).setValues(values);
  }

  sheet.setFrozenRows(1);
  applySheetColumnWidths_(sheet);
}

function buildPayroll_(auxRows, refs) {
  const byInstructor = {};
  const groupSessions = {};
  const lessonSessions = {};

  auxRows.forEach(row => {
    const name = row.instructorName;
    if (!name) return;

    if (!byInstructor[name]) {
      byInstructor[name] = {
        name,
        groupCount: 0,
        privateCount: 0,
        lessonCount: 0,
        groupPay: 0,
        privatePay: 0,
        lessonPay: 0,
        groupRevenue: 0,
        privateRevenue: 0,
        lessonRevenue: 0
      };
    }

    if (row.finalType === '그룹') {
      if (!groupSessions[row.sessionKey]) {
        groupSessions[row.sessionKey] = {
          instructorName: name,
          weekday: row.weekday,
          classTime: row.classTime,
          booked: 0,
          attended: 0,
          revenue: 0
        };
      }

      groupSessions[row.sessionKey].booked += 1;
      if (row.attendanceFlag) {
        groupSessions[row.sessionKey].attended += 1;
        groupSessions[row.sessionKey].revenue += row.settlementRevenue;
      }
      return;
    }

    if (row.finalType === '프라이빗') {
      if (!row.settlementCount) return;
      byInstructor[name].privateCount += row.settlementCount;
      byInstructor[name].privateRevenue += row.settlementRevenue;
      byInstructor[name].privatePay += row.linePay;
      return;
    }

    if (row.finalType === '강사레슨') {
      if (!lessonSessions[row.sessionKey]) {
        lessonSessions[row.sessionKey] = {
          instructorName: name,
          attended: 0,
          revenue: 0,
          pay: 0
        };
      }

      if (!row.settlementCount) return;
      lessonSessions[row.sessionKey].attended += row.settlementCount;
      lessonSessions[row.sessionKey].revenue += row.settlementRevenue;
      lessonSessions[row.sessionKey].pay = Math.max(lessonSessions[row.sessionKey].pay, row.linePay);
    }
  });

  Object.keys(groupSessions).forEach(key => {
    const session = groupSessions[key];
    const name = session.instructorName;
    byInstructor[name].groupCount += 1;
    byInstructor[name].groupRevenue += session.revenue;

    const rates = refs.groupMap[name] || CONFIG.DEFAULT_GROUP_RATES;
    const pay = rates[session.attended] !== undefined ? rates[session.attended] : rates[rates.length - 1];
    byInstructor[name].groupPay += Math.round(pay);
  });

  Object.keys(lessonSessions).forEach(key => {
    const session = lessonSessions[key];
    if (session.attended <= 0) return;
    const name = session.instructorName;
    byInstructor[name].lessonCount += 1;
    byInstructor[name].lessonRevenue += session.revenue;
    byInstructor[name].lessonPay += session.pay;
  });

  const rows = Object.values(byInstructor)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .map((row, index) => {
      const totalRevenue = Math.round(row.groupRevenue + row.privateRevenue + row.lessonRevenue);
      const totalPay = Math.round(row.groupPay + row.privatePay + row.lessonPay);
      const withholding = Math.floor(totalPay * CONFIG.WITHHOLDING_RATE);
      const netPay = totalPay - withholding;
      const marginRate = totalRevenue > 0 ? (totalRevenue - totalPay) / totalRevenue : 0;

      return {
        no: index + 1,
        name: row.name,
        groupCount: row.groupCount,
        privateCount: row.privateCount,
        lessonCount: row.lessonCount,
        groupPay: Math.round(row.groupPay),
        privatePay: Math.round(row.privatePay),
        lessonPay: Math.round(row.lessonPay),
        totalPay,
        withholding,
        netPay,
        totalRevenue,
        marginRate
      };
    });

  return { rows, groupSessions, lessonSessions };
}

function writePayrollSheet_(ss, rows) {
  const sheet = resetSheet_(ss, '정산대장');

  const header = [[
    '순번', '성명', '그룹횟수', '프라이빗횟수', '강사레슨횟수',
    '그룹보수합계', '프라이빗보수합계', '강사레슨보수합계',
    '세전총액', '공제(3.3%)', '실지급액', '총매출', '수업 마진률'
  ]];

  const values = rows.map(row => [
    row.no, row.name, row.groupCount, row.privateCount, row.lessonCount,
    row.groupPay, row.privatePay, row.lessonPay,
    row.totalPay, row.withholding, row.netPay, row.totalRevenue, row.marginRate
  ]);

  const totalRows = 1 + values.length;
  resizeSheetToFit_(sheet, totalRows, header[0].length);

  sheet.getRange(1, 1, 1, header[0].length).setValues(header)
    .setFontWeight('bold')
    .setBackground('#D9EAD3')
    .setHorizontalAlignment('center');

  if (values.length) {
    sheet.getRange(2, 1, values.length, header[0].length).setValues(values);
    sheet.getRange(2, 13, values.length, 1).setNumberFormat('0.0%');
  }

  sheet.setFrozenRows(1);
  applySheetColumnWidths_(sheet);
}

function buildMonthlyReport_(auxRows, payrollRows) {
  const groupRows = auxRows.filter(row => row.finalType === '그룹');
  const groupSessions = {};

  groupRows.forEach(row => {
    if (!groupSessions[row.sessionKey]) {
      groupSessions[row.sessionKey] = {
        instructorName: row.instructorName,
        weekday: row.weekday,
        time: row.classTime,
        booked: 0,
        attended: 0
      };
    }

    groupSessions[row.sessionKey].booked += 1;
    if (row.attendanceFlag) groupSessions[row.sessionKey].attended += 1;
  });

  const sessions = Object.values(groupSessions);
  const totalSessions = sessions.length;
  const totalBooked = sessions.reduce((sum, row) => sum + row.booked, 0);
  const totalAttended = sessions.reduce((sum, row) => sum + row.attended, 0);
  const avgBooked = totalSessions ? totalBooked / totalSessions : 0;
  const avgAttended = totalSessions ? totalAttended / totalSessions : 0;
  const avgBookingRate = CONFIG.GROUP_CAPACITY > 0 ? avgBooked / CONFIG.GROUP_CAPACITY : 0;
  const avgAttendanceRate = totalBooked ? totalAttended / totalBooked : 0;

  const instructorMap = {};
  sessions.forEach(session => {
    if (!instructorMap[session.instructorName]) {
      instructorMap[session.instructorName] = { sessions: 0, booked: 0, attended: 0 };
    }
    instructorMap[session.instructorName].sessions += 1;
    instructorMap[session.instructorName].booked += session.booked;
    instructorMap[session.instructorName].attended += session.attended;
  });

  const instructorStats = Object.keys(instructorMap)
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .map(name => {
      const row = instructorMap[name];
      return {
        name,
        avgBooked: row.sessions ? row.booked / row.sessions : 0,
        avgAttended: row.sessions ? row.attended / row.sessions : 0,
        bookingRate: CONFIG.GROUP_CAPACITY > 0 ? (row.booked / row.sessions) / CONFIG.GROUP_CAPACITY : 0,
        attendanceRate: row.booked ? row.attended / row.booked : 0
      };
    });

  const lowSessions = sessions.map(session => ({
    weekday: session.weekday,
    time: session.time,
    instructorName: session.instructorName,
    booked: session.booked,
    attended: session.attended,
    bookingRate: CONFIG.GROUP_CAPACITY > 0 ? session.booked / CONFIG.GROUP_CAPACITY : 0,
    attendanceRate: session.booked ? session.attended / session.booked : 0
  }))
    .sort((a, b) => a.bookingRate - b.bookingRate || a.attendanceRate - b.attendanceRate)
    .slice(0, 10);

  return {
    summary: { totalSessions, totalBooked, totalAttended, avgBooked, avgAttended, avgBookingRate, avgAttendanceRate },
    instructorStats,
    lowSessions,
    payrollRows
  };
}

function writeReportSheet_(ss, report) {
  const sheet = resetSheet_(ss, '월간리포트');
  let row = 1;

  sheet.getRange(row, 1).setValue('아카이브 월간 운영 리포트')
    .setFontSize(14)
    .setFontWeight('bold');
  row += 2;

  sheet.getRange(row, 1, 1, 7).setValues([[
    '전체 그룹 세션 수', '그룹 예약총인원', '그룹 출석총인원',
    '그룹 예약평균', '그룹 출석평균', '전체 그룹 예약률', '전체 그룹 출석률'
  ]])
    .setFontWeight('bold')
    .setBackground('#FCE5CD');
  row += 1;

  sheet.getRange(row, 1, 1, 7).setValues([[
    report.summary.totalSessions,
    report.summary.totalBooked,
    report.summary.totalAttended,
    round2_(report.summary.avgBooked),
    round2_(report.summary.avgAttended),
    report.summary.avgBookingRate,
    report.summary.avgAttendanceRate
  ]]);
  sheet.getRange(row, 6, 1, 2).setNumberFormat('0.0%');
  row += 3;

  sheet.getRange(row, 1, 1, 5).setValues([[
    '강사명', '그룹 예약평균', '그룹 출석평균', '그룹 예약률', '그룹 출석률'
  ]])
    .setFontWeight('bold')
    .setBackground('#D9EAD3');
  row += 1;

  const instructorValues = report.instructorStats.map(item => [
    item.name,
    round2_(item.avgBooked),
    round2_(item.avgAttended),
    item.bookingRate,
    item.attendanceRate
  ]);

  if (instructorValues.length) {
    sheet.getRange(row, 1, instructorValues.length, 5).setValues(instructorValues);
    sheet.getRange(row, 4, instructorValues.length, 2).setNumberFormat('0.0%');
    row += instructorValues.length + 2;
  }

  sheet.getRange(row, 1, 1, 6).setValues([[
    '비인기 그룹 수업 후보 요일', '시간대', '강사명', '예약수', '예약률', '출석률'
  ]])
    .setFontWeight('bold')
    .setBackground('#F4CCCC');
  row += 1;

  const lowValues = report.lowSessions.map(item => [
    item.weekday,
    item.time,
    item.instructorName,
    item.booked,
    item.bookingRate,
    item.attendanceRate
  ]);

  if (lowValues.length) {
    sheet.getRange(row, 1, lowValues.length, 6).setValues(lowValues);
    sheet.getRange(row, 5, lowValues.length, 2).setNumberFormat('0.0%');
    row += lowValues.length + 2;
  }

  sheet.getRange(row, 1, 1, 6).setValues([[
    '강사명', '총매출', '총보수', '실지급액', '수업 마진률', '비고'
  ]])
    .setFontWeight('bold')
    .setBackground('#CFE2F3');
  row += 1;

  const payrollValues = report.payrollRows.map(item => [
    item.name,
    item.totalRevenue,
    item.totalPay,
    item.netPay,
    item.marginRate,
    item.marginRate <= 0.4 ? '마진 낮음 확인 필요' : ''
  ]);

  if (payrollValues.length) {
    sheet.getRange(row, 1, payrollValues.length, 6).setValues(payrollValues);
    sheet.getRange(row, 2, payrollValues.length, 3).setNumberFormat('#,##0');
    sheet.getRange(row, 5, payrollValues.length, 1).setNumberFormat('0.0%');
    row += payrollValues.length;
  }

  resizeSheetToFit_(sheet, row, 8);
  applySheetColumnWidths_(sheet);

  return { reportSheetId: sheet.getSheetId() };
}

function ensureDashboardExportForBackup_(spreadsheetId, monthKey) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const exportSheet = ss.getSheetByName(CONFIG.DASHBOARD_EXPORT_SHEET_NAME);
  if (exportSheet && exportSheet.getLastRow() > 1) return;

  const payrollRows = readPayrollRowsFromSheet_(ss);
  const report = readMonthlyReportFromSheet_(ss, payrollRows);
  writeDashboardExportSheet_(ss, monthKey, payrollRows, report);
}

function writeDashboardExportSheet_(ss, monthKey, payrollRows, report) {
  const sheet = resetSheet_(ss, CONFIG.DASHBOARD_EXPORT_SHEET_NAME);
  const generatedAt = new Date().toISOString();
  const sourceSpreadsheetId = ss.getId();
  const sourceSpreadsheetName = ss.getName();
  const summary = buildDashboardSummaryPayload_(monthKey, payrollRows, report);
  const headers = ['section', 'month', 'key', 'payloadJson', 'sourceSpreadsheetId', 'sourceSpreadsheetName', 'generatedAt'];
  const rows = [headers];

  rows.push(exportRow_('summary', monthKey, 'summary:' + monthKey, summary, sourceSpreadsheetId, sourceSpreadsheetName, generatedAt));

  payrollRows.forEach(row => {
    rows.push(exportRow_('강사별', monthKey, '강사별:' + monthKey + ':' + row.name, {
      월: monthKey,
      강사: row.name,
      총매출: Math.round(row.totalRevenue),
      세전총액: Math.round(row.totalPay),
      실지급액: Math.round(row.netPay)
    }, sourceSpreadsheetId, sourceSpreadsheetName, generatedAt));
  });

  report.instructorStats.forEach(row => {
    rows.push(exportRow_('강사통계', monthKey, '강사통계:' + monthKey + ':' + row.name, {
      월: monthKey,
      강사: row.name,
      그룹예약률: round1_(row.bookingRate * 100),
      그룹출석률: round1_(row.attendanceRate * 100),
      그룹평균인원: round2_(row.avgAttended)
    }, sourceSpreadsheetId, sourceSpreadsheetName, generatedAt));
    rows.push(exportRow_('월별강사평균인원', monthKey, '월별강사평균인원:' + monthKey + ':' + row.name, {
      월: monthKey,
      강사: row.name,
      그룹평균인원: round2_(row.avgAttended)
    }, sourceSpreadsheetId, sourceSpreadsheetName, generatedAt));
  });

  rows.push(exportRow_('meta', monthKey, 'updatedAt', { updatedAt: generatedAt }, sourceSpreadsheetId, sourceSpreadsheetName, generatedAt));

  resizeSheetToFit_(sheet, rows.length, headers.length);
  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#E8F0FE')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  applySheetColumnWidths_(sheet);
}

function buildDashboardSummaryPayload_(monthKey, payrollRows, report) {
  const totalRevenue = payrollRows.reduce((sum, row) => sum + row.totalRevenue, 0);
  const totalPay = payrollRows.reduce((sum, row) => sum + row.totalPay, 0);
  const netPay = payrollRows.reduce((sum, row) => sum + row.netPay, 0);
  return {
    월: monthKey,
    총매출: Math.round(totalRevenue),
    수업매출: Math.round(totalRevenue),
    실지급액: Math.round(netPay),
    세전총액: Math.round(totalPay),
    마진률: totalRevenue ? round1_(((totalRevenue - totalPay) / totalRevenue) * 100) : 0,
    그룹세션: report.summary.totalSessions,
    프라이빗: round2_(payrollRows.reduce((sum, row) => sum + row.privateCount, 0)),
    강사레슨: round2_(payrollRows.reduce((sum, row) => sum + row.lessonCount, 0)),
    예약률: round1_(report.summary.avgBookingRate * 100),
    출석률: round1_(report.summary.avgAttendanceRate * 100)
  };
}

function exportRow_(section, monthKey, key, payload, sourceSpreadsheetId, sourceSpreadsheetName, generatedAt) {
  return [section, monthKey, key, JSON.stringify(payload), sourceSpreadsheetId, sourceSpreadsheetName, generatedAt];
}

function readPayrollRowsFromSheet_(ss) {
  const sheet = ss.getSheetByName('정산대장');
  if (!sheet) throw new Error('정산대장 시트를 찾을 수 없습니다.');
  const values = sheet.getDataRange().getValues();
  return values.slice(1)
    .filter(row => row[1])
    .map(row => ({
      no: toNumber_(row[0]),
      name: String(row[1] || '').trim(),
      groupCount: toNumber_(row[2]),
      privateCount: toNumber_(row[3]),
      lessonCount: toNumber_(row[4]),
      groupPay: toNumber_(row[5]),
      privatePay: toNumber_(row[6]),
      lessonPay: toNumber_(row[7]),
      totalPay: toNumber_(row[8]),
      withholding: toNumber_(row[9]),
      netPay: toNumber_(row[10]),
      totalRevenue: toNumber_(row[11]),
      marginRate: toNumber_(row[12])
    }));
}

function readMonthlyReportFromSheet_(ss, payrollRows) {
  const sheet = ss.getSheetByName('월간리포트');
  if (!sheet) throw new Error('월간리포트 시트를 찾을 수 없습니다.');
  const values = sheet.getDataRange().getValues();
  const summaryRow = values[3] || [];
  const instructorStats = [];
  for (let i = 7; i < values.length; i++) {
    const row = values[i] || [];
    if (!row[0]) break;
    instructorStats.push({
      name: String(row[0] || '').trim(),
      avgBooked: toNumber_(row[1]),
      avgAttended: toNumber_(row[2]),
      bookingRate: toNumber_(row[3]),
      attendanceRate: toNumber_(row[4])
    });
  }
  return {
    summary: {
      totalSessions: toNumber_(summaryRow[0]),
      totalBooked: toNumber_(summaryRow[1]),
      totalAttended: toNumber_(summaryRow[2]),
      avgBooked: toNumber_(summaryRow[3]),
      avgAttended: toNumber_(summaryRow[4]),
      avgBookingRate: toNumber_(summaryRow[5]),
      avgAttendanceRate: toNumber_(summaryRow[6])
    },
    instructorStats,
    lowSessions: [],
    payrollRows
  };
}

function buildBulkSummaryMessage_(targetMonthKey, totalCount, processedCount, skippedCount) {
  return [
    '[아카이브 정산 자동화]',
    `- 대상월: ${targetMonthKey}`,
    `- 원본 파일 수: ${totalCount}건`,
    `- 신규/갱신 백업 생성: ${processedCount}건`,
    `- 이미 최신이라 건너뜀: ${skippedCount}건`
  ].join('\n');
}

function sendWebhookSummary_(text) {
  if (!CONFIG.SUMMARY_WEBHOOK_URL) return;

  UrlFetchApp.fetch(CONFIG.SUMMARY_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text })
  });
}

function getHeaderIndexMap_(headers) {
  const map = {};
  headers.forEach((header, idx) => {
    const key = String(header || '').trim();
    if (key) map[key] = idx;
  });
  return map;
}

function getCellByAliases_(row, headerMap, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const idx = headerMap[aliases[i]];
    if (idx !== undefined && idx >= 0) return row[idx];
  }
  return '';
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function resetSheet_(ss, name) {
  const existing = ss.getSheetByName(name);
  if (existing) {
    existing.clear();
    return existing;
  }
  return ss.insertSheet(name);
}

function normalizeDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value || '').trim();
}

function normalizeTime_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(value || '').trim();
}

function getWeekdayKorean_(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return weekdays[d.getDay()] || '';
}

function toNumber_(value) {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined || value === '') return 0;
  return Number(String(value).replace(/,/g, '').trim()) || 0;
}

function round2_(num) {
  return Math.round(num * 100) / 100;
}

function round1_(num) {
  return Math.round(num * 10) / 10;
}

function getSettlementCount_(attendance) {
  const value = String(attendance || '').trim();
  if (value === '출석') return 1;
  if (value === '노쇼') return 0.5;
  return 0;
}

function resizeSheetToFit_(sheet, requiredRows, requiredCols) {
  const minRows = Math.max(requiredRows, 1);
  const minCols = Math.max(requiredCols, 1);

  const currentRows = sheet.getMaxRows();
  const currentCols = sheet.getMaxColumns();

  if (currentRows < minRows) {
    sheet.insertRowsAfter(currentRows, minRows - currentRows);
  } else if (currentRows > minRows) {
    sheet.deleteRows(minRows + 1, currentRows - minRows);
  }

  if (currentCols < minCols) {
    sheet.insertColumnsAfter(currentCols, minCols - currentCols);
  } else if (currentCols > minCols) {
    sheet.deleteColumns(minCols + 1, currentCols - minCols);
  }
}

function applySheetColumnWidths_(sheet) {
  const name = sheet.getName();

  if (name === '시트1') {
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 420);
    sheet.setColumnWidth(3, 170);
    sheet.setColumnWidth(4, 100);
    sheet.setColumnWidth(5, 100);
    sheet.setColumnWidth(6, 100);
    sheet.setColumnWidth(7, 260);
    sheet.getRange('B:B').setWrap(true);
    sheet.getRange('G:G').setWrap(true);
    return;
  }

  if (name === '정산보조') {
    sheet.setColumnWidth(1, 220);
    sheet.setColumnWidth(2, 110);
    sheet.setColumnWidth(3, 70);
    sheet.setColumnWidth(4, 90);
    sheet.setColumnWidth(5, 120);
    sheet.setColumnWidth(6, 100);
    sheet.setColumnWidth(7, 110);
    sheet.setColumnWidth(8, 110);
    sheet.setColumnWidth(9, 220);
    sheet.setColumnWidth(10, 70);
    sheet.setColumnWidth(11, 100);
    sheet.setColumnWidth(12, 220);
    sheet.setColumnWidth(13, 80);
    sheet.setColumnWidth(14, 100);
    sheet.setColumnWidth(15, 90);
    sheet.setColumnWidth(16, 100);
    sheet.getRange('I:I').setWrap(true);
    sheet.getRange('L:L').setWrap(true);
    return;
  }

  if (name === '정산대장') {
    for (let col = 1; col <= 13; col++) {
      sheet.setColumnWidth(col, 110);
    }
    sheet.setColumnWidth(2, 100);
    sheet.setColumnWidth(6, 120);
    sheet.setColumnWidth(7, 140);
    sheet.setColumnWidth(8, 140);
    sheet.setColumnWidth(9, 120);
    sheet.setColumnWidth(12, 120);
    sheet.setColumnWidth(13, 120);
    return;
  }

  if (name === '월간리포트') {
    for (let col = 1; col <= 8; col++) {
      sheet.setColumnWidth(col, 140);
    }
    return;
  }

  if (name === CONFIG.DASHBOARD_EXPORT_SHEET_NAME) {
    sheet.setColumnWidth(1, 140);
    sheet.setColumnWidth(2, 100);
    sheet.setColumnWidth(3, 240);
    sheet.setColumnWidth(4, 520);
    sheet.setColumnWidth(5, 300);
    sheet.setColumnWidth(6, 180);
    sheet.setColumnWidth(7, 220);
    sheet.getRange('D:D').setWrap(true);
  }
}
function removeDefaultSheetIfUnused_(ss) {
  const defaultSheet = ss.getSheetByName('시트1');
  if (!defaultSheet) return;

  const hasOnlyBlankCell =
    defaultSheet.getLastRow() <= 1 &&
    defaultSheet.getLastColumn() <= 1 &&
    String(defaultSheet.getRange(1, 1).getValue() || '').trim() === '';

  if (hasOnlyBlankCell && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
}
/**
 * 정산 DB 웹앱 호출
 */
function triggerArchiveDbSync_() {
  if (!CONFIG.DB_SYNC_WEBAPP_URL) {
    return { ok: true, skipped: true, message: '정산 DB 자동 갱신은 별도 동기화에서 처리합니다.' };
  }

  var payload = {
    key: CONFIG.DB_SYNC_SECRET_KEY,
    source: 'archive-automation',
    requestedAt: new Date().toISOString()
  };

  var response = UrlFetchApp.fetch(CONFIG.DB_SYNC_WEBAPP_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('정산 DB 호출 실패 (' + code + '): ' + body);
  }

  var parsed = {};
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error('정산 DB 응답 파싱 실패: ' + body);
  }

  if (!parsed.ok) {
    throw new Error('정산 DB 갱신 실패: ' + parsed.message);
  }

  return parsed;
}
