export function summarizeCurrentSettlementOperation({ auxRows, payrollRows, reportRows }) {
  if ((!auxRows || auxRows.length === 0) && (!payrollRows || payrollRows.length === 0)) return null;

  const auxHeader = (auxRows[0] || []).map(clean);
  const auxIndex = Object.fromEntries(auxHeader.map((name, index) => [name, index]));
  const payrollHeader = (payrollRows[0] || []).map(clean);
  const payrollIndex = Object.fromEntries(payrollHeader.map((name, index) => [name, index]));
  const aux = auxRows.slice(1);
  const payroll = payrollRows.slice(1);

  const groupRevenue = aux
    .filter((row) => clean(row[auxIndex["최종수업구분"]]) === "그룹")
    .reduce((sum, row) => sum + money(row[auxIndex["정산매출"]]), 0);
  const privateRevenue = aux
    .filter((row) => clean(row[auxIndex["최종수업구분"]]) === "프라이빗")
    .reduce((sum, row) => sum + money(row[auxIndex["정산매출"]]), 0);
  const groupPay = payroll.reduce((sum, row) => sum + money(row[payrollIndex["그룹보수합계"]]), 0);
  const privatePay = payroll.reduce((sum, row) => sum + money(row[payrollIndex["프라이빗보수합계"]]), 0);
  const privateCount = payroll.reduce((sum, row) => sum + number(row[payrollIndex["프라이빗횟수"]]), 0);

  return {
    groupAttendanceAverage: readReportSummaryValue(reportRows, "그룹 출석평균"),
    groupReservationAverage: readReportSummaryValue(reportRows, "그룹 예약평균"),
    groupRevenue,
    groupPay,
    privateCount,
    privateRevenue,
    privatePay,
  };
}

function readReportSummaryValue(reportRows, headerName) {
  for (let index = 0; index < reportRows.length - 1; index += 1) {
    const header = reportRows[index].map(clean);
    const valueIndex = header.indexOf(headerName);
    if (valueIndex < 0) continue;
    return number(reportRows[index + 1]?.[valueIndex]);
  }
  return 0;
}

function clean(value) {
  return String(value ?? "").trim();
}

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return number(value);
}
