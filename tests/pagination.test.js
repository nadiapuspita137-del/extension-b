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

test("combines a strong identifier with transaction details", () => {
  assert.equal(
    transactionIdentity({ rrn: "123", username: "UserA", amountText: "50.000" }),
    "rrn:123|user:usera|amount:50.000|datetime:|bank:"
  );
  assert.equal(
    transactionIdentity({ reference: "x", username: "UserA", amountText: "10.000" }),
    "reference:x|user:usera|amount:10.000|datetime:|bank:"
  );
  assert.equal(
    transactionIdentity({ rowNumber: " 1001 ", username: "UserA" }, 2),
    "page:2|row:1001|user:usera|amount:|datetime:|bank:"
  );
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

test("keeps manual DP and bonus rows that reuse the same RRN", () => {
  const merged = mergePageResponses([
    response(1, [
      {
        username: "DIMAS2003",
        amountText: "50.000",
        datetime: "26/08/2026 10:00",
        rrn: "shared-reference",
        toBank: "PrabuPay bolapelangi2_oauser"
      },
      {
        username: "DIMAS2003",
        amountText: "10.000",
        datetime: "26/08/2026 10:01",
        rrn: "shared-reference",
        toBank: "SCB A BONUS DEPOSIT HARIAN 01"
      }
    ])
  ]);

  assert.equal(merged.rows.length, 2);
  assert.deepEqual(merged.rows.map((row) => row.amountText), ["50.000", "10.000"]);
});

test("keeps different transactions when row numbers restart on each page", () => {
  const merged = mergePageResponses([
    response(1, [{ username: "a", amountText: "50.000", rowNumber: "1" }]),
    response(2, [{ username: "b", amountText: "75.000", rowNumber: "1" }])
  ]);

  assert.equal(merged.rows.length, 2);
});
