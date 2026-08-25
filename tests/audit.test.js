import test from "node:test";
import assert from "node:assert/strict";

import { AUDIT_ISSUE, AUDIT_STATUS, auditBonusPayments } from "../core/audit.js";

const row = (usernameKey, amount) => ({ username: usernameKey, usernameKey, amount });

test("audit marks a matching single bonus as correct", () => {
  const audit = auditBonusPayments([row("a", 300_000)], [], [row("a", 30_000)]);
  assert.equal(audit.rows[0].status, AUDIT_STATUS.CORRECT);
  assert.equal(audit.stats.correct, 1);
});

test("audit detects overpaid, underpaid, and double bonus totals", () => {
  const over = auditBonusPayments([row("a", 300_000)], [], [row("a", 40_000)]);
  assert.ok(over.rows[0].issues.includes(AUDIT_ISSUE.OVERPAID));
  const under = auditBonusPayments([row("a", 300_000)], [], [row("a", 20_000)]);
  assert.ok(under.rows[0].issues.includes(AUDIT_ISSUE.UNDERPAID));
  const doubled = auditBonusPayments([row("a", 300_000)], [], [row("a", 30_000), row("a", 30_000)]);
  assert.ok(doubled.rows[0].issues.includes(AUDIT_ISSUE.DOUBLE_BONUS));
  assert.ok(doubled.rows[0].issues.includes(AUDIT_ISSUE.OVERPAID));
});

test("audit detects bonus without eligibility", () => {
  const noDp = auditBonusPayments([], [], [row("x", 10_000)]);
  assert.ok(noDp.rows[0].issues.includes(AUDIT_ISSUE.NO_DP));
  const above = auditBonusPayments([row("a", 600_000)], [], [row("a", 50_000)]);
  assert.ok(above.rows[0].issues.includes(AUDIT_ISSUE.OUT_OF_RANGE_ABOVE));
  const wd = auditBonusPayments([row("a", 300_000)], [row("a", 1)], [row("a", 30_000)]);
  assert.ok(wd.rows[0].issues.includes(AUDIT_ISSUE.FOUND_WD));
  const stopped = auditBonusPayments([row("a", 300_000)], [], [row("a", 30_000)], [row("a", 0)]);
  assert.ok(stopped.rows[0].issues.includes(AUDIT_ISSUE.STOP_BNS));
});

test("audit lists an eligible ID with no SCB bonus as missing", () => {
  const audit = auditBonusPayments([row("a", 75_000)], [], []);
  assert.equal(audit.rows[0].status, AUDIT_STATUS.MISSING);
  assert.equal(audit.rows[0].expectedBonus, 7_000);
});
