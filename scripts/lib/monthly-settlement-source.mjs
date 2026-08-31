export function dedupeSettlementSourceRows(sourceRows) {
  const uniqueRows = [];
  const seen = new Map();
  const duplicateByKey = new Map();

  for (const row of sourceRows || []) {
    const key = settlementSourceKey(row);
    if (!seen.has(key)) {
      seen.set(key, row);
      uniqueRows.push(row);
      continue;
    }

    const duplicate = duplicateByKey.get(key) || {
      key,
      sourceCount: 1,
      removedCount: 0,
      row: seen.get(key),
    };
    duplicate.sourceCount += 1;
    duplicate.removedCount += 1;
    duplicateByKey.set(key, duplicate);
  }

  return {
    rows: uniqueRows,
    duplicates: [...duplicateByKey.values()],
    removedCount: [...duplicateByKey.values()].reduce((sum, item) => sum + item.removedCount, 0),
  };
}

export function settlementSourceKey(row) {
  return [
    row?.originalType,
    row?.finalType,
    row?.classDate,
    row?.classTime,
    row?.endTime,
    row?.weekday,
    row?.memberName,
    row?.ticketName,
    row?.revenue,
    row?.instructorName,
    row?.attendance,
  ].map(normalize).join("|");
}

function normalize(value) {
  return String(value ?? "").trim().normalize("NFC");
}
