function normalizeIdentityPart(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("id-ID");
}

function transactionDetails(row) {
  return [
    `user:${normalizeIdentityPart(row?.username)}`,
    `amount:${normalizeIdentityPart(row?.amountText)}`,
    `datetime:${normalizeIdentityPart(row?.datetime)}`,
    `bank:${normalizeIdentityPart(row?.toBank)}`
  ].join("|");
}

export function transactionIdentity(row, pageNumber = null) {
  const details = transactionDetails(row);
  const rrn = normalizeIdentityPart(row?.rrn);
  if (rrn) return `rrn:${rrn}|${details}`;

  const reference = normalizeIdentityPart(row?.reference);
  if (reference) return `reference:${reference}|${details}`;

  // Row numbers restart on every page. Keep the page in the fallback key so
  // unrelated transactions on page 1 and page 2 are never merged together.
  const rowNumber = normalizeIdentityPart(row?.rowNumber).replace(/\s+/g, "");
  const page = normalizeIdentityPart(pageNumber);
  if (rowNumber) return `page:${page || "unknown"}|row:${rowNumber}|${details}`;

  // Without an RRN/reference/row number, preserving a transaction is safer
  // than silently deleting a possibly legitimate duplicate payment.
  return "";
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
      const identity = transactionIdentity(row, response.pagination?.currentPage);
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
