import test from "node:test";
import assert from "node:assert/strict";

import { mergePageResponses, transactionIdentity } from "../core/pagination.js";

const response = (page, rows) => ({
  ok: true,
  pageType: "DP",
  rows,
  sourceRowCount: rows.length,
  skippedWithoutUsername: 0,
  pagination: { available: true, currentPage: page, totalPages: 2, totalRecords: 1002 },
  source: { tableId: "AddCreditHistory_cm1_g" }
});

test("uses RRN, Reference, then row number as transaction identity", () => {
  assert.equal(transactionIdentity({ rrn: "123", reference: "x", rowNumber: "1" }), "rrn:123");
  assert.equal(transactionIdentity({ reference: "x", rowNumber: "1" }), "reference:x");
  assert.equal(transactionIdentity({ rowNumber: " 1001 " }), "row:1001");
});

test("merges all pages and removes repeated strong transaction identities", () => {
  const merged = mergePageResponses([
    response(1, [{ username: "a", rrn: "r1" }, { username: "b", rrn: "r2" }]),
    response(2, [{ username: "b", rrn: "r2" }, { username: "c", rrn: "r3" }])
  ]);

  assert.deepEqual(merged.rows.map((row) => row.username), ["a", "b", "c"]);
  assert.equal(merged.pagination.pagesScanned, 2);
  assert.equal(merged.pagination.totalRecords, 1002);
});
