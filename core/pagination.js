export function transactionIdentity(row) {
  const rrn = String(row?.rrn ?? "").trim();
  if (rrn) return `rrn:${rrn}`;
  const reference = String(row?.reference ?? "").trim();
  if (reference) return `reference:${reference}`;
  const rowNumber = String(row?.rowNumber ?? "").replace(/\s+/g, "").trim();
  return rowNumber ? `row:${rowNumber}` : "";
}

export function mergePageResponses(pageResponses) {
  if (!Array.isArray(pageResponses) || pageResponses.length === 0) {
    throw new Error("No page responses to merge.");
  }

  const first = pageResponses[0];
  const rows = [];
  const seenTransactions = new Set();
  let skippedWithoutUsername = 0;
  let sourceRowCount = 0;

  for (const response of pageResponses) {
    skippedWithoutUsername += response.skippedWithoutUsername ?? 0;
    sourceRowCount += response.sourceRowCount ?? response.rows.length;
    for (const row of response.rows) {
      const identity = transactionIdentity(row);
      if (identity && seenTransactions.has(identity)) continue;
      if (identity) seenTransactions.add(identity);
      rows.push(row);
    }
  }

  return {
    ...first,
    rows,
    empty: rows.length === 0,
    skippedWithoutUsername,
    sourceRowCount,
    pagination: {
      available: first.pagination?.available ?? false,
      currentPage: 1,
      totalPages: pageResponses.length,
      totalRecords: first.pagination?.totalRecords ?? null,
      pagesScanned: pageResponses.length
    },
    source: {
      ...first.source,
      pagesScanned: pageResponses.length,
      totalRecords: first.pagination?.totalRecords ?? null
    }
  };
}
