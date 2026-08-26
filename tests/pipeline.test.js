import test from "node:test";
import assert from "node:assert/strict";

import { buildDerivedResults, createSnapshot } from "../core/pipeline.js";
import { mergePageResponses } from "../core/pagination.js";
import { AUDIT_ISSUE } from "../core/audit.js";

function response(pageType, rows, columns = {}) {
  return {
    pageType,
    rows,
    sourceRowCount: rows.length,
    skippedWithoutUsername: 0,
    pagination: { pagesScanned: 1, totalPages: 1, totalRecords: rows.length },
    source: { columns }
  };
}

test("snapshot pipeline separates daily bonus history from manual DP", () => {
  const scb = createSnapshot(response("SCB", [
    { username: "historyUser", amountText: "10.000", datetime: "", toBank: "SCB A BONUS DEPOSIT HARIAN 01" },
    { username: "manualUser", amountText: "100.000", datetime: "", toBank: "DANA" },
    { username: "otherScb", amountText: "20.000", datetime: "", toBank: "SCB B BONUS MEMBER BARU 02" }
  ], { toBank: 3 }), "2026-08-26T01:00:00.000Z");

  assert.equal(scb.rows.length, 1);
  assert.equal(scb.rows[0].usernameKey, "historyuser");
  assert.equal(scb.manualDepositRows.length, 1);
  assert.equal(scb.manualDepositRows[0].usernameKey, "manualuser");
  assert.equal(scb.source.excludedInternalScbRows, 1);
});

test("derived pipeline combines QRIS and manual DP consistently", () => {
  const capturedAt = "2026-08-26T01:00:00.000Z";
  const dp = createSnapshot(response("DP", [
    { username: "qrisUser", amountText: "75.000", datetime: "26/08/2026" }
  ]), capturedAt);
  const wd = createSnapshot(response("WD", []), capturedAt);
  const scb = createSnapshot(response("SCB", [
    { username: "manualUser", amountText: "100.000", datetime: "26/08/2026", toBank: "DANA" }
  ], { toBank: 3 }), capturedAt);

  const derived = buildDerivedResults({ dp, wd, scb, stopBns: { ids: [] } }, capturedAt);
  assert.equal(derived.validation.stats.eligible, 2);
  assert.equal(derived.bonusQueue.stats.ready, 2);
  assert.equal(derived.bonusAudit.stats.missing, 2);
});

test("audit retains manual DP when its RRN is reused by the bonus payment", () => {
  const capturedAt = "2026-08-26T02:00:00.000Z";
  const scbResponse = mergePageResponses([
    response("SCB", [
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
    ], { toBank: 4 })
  ]);
  const scb = createSnapshot(scbResponse, capturedAt);
  const empty = { rows: [], capturedAt };
  const derived = buildDerivedResults({
    dp: empty,
    wd: empty,
    scb,
    stopBns: { ids: [] }
  }, capturedAt);

  assert.equal(scb.manualDepositRows.length, 1);
  assert.equal(scb.rows.length, 1);
  assert.equal(derived.bonusAudit.stats.overpaid, 1);
  assert.equal(derived.bonusAudit.stats.noDp, 0);
  assert.ok(derived.bonusAudit.rows[0].issues.includes(AUDIT_ISSUE.OVERPAID));
});
