import test from "node:test";
import assert from "node:assert/strict";

import {
  AUDIT_ISSUE,
  AUDIT_RULES_VERSION,
  AUDIT_STATUS,
  auditBonusPayments
} from "../core/audit.js";

const row = (usernameKey, amount, datetime = "") => ({ username: usernameKey, usernameKey, amount, datetime });

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
  const below = auditBonusPayments([row("a", 49_999)], [], [row("a", 5_000)]);
  assert.ok(below.rows[0].issues.includes(AUDIT_ISSUE.OUT_OF_RANGE_BELOW));
  const wd = auditBonusPayments([row("a", 300_000)], [row("a", 1)], [row("a", 30_000)]);
  assert.ok(wd.rows[0].issues.includes(AUDIT_ISSUE.FOUND_WD));
  const stopped = auditBonusPayments([row("a", 300_000)], [], [row("a", 30_000)], [row("a", 0)]);
  assert.ok(stopped.rows[0].issues.includes(AUDIT_ISSUE.STOP_BNS));
});

test("audit still compares the nominal when an ID also has WD", () => {
  const audit = auditBonusPayments(
    [row("bfj@dimas2003", 50_000)],
    [row("bfj@dimas2003", 2_100)],
    [row("bfj@dimas2003", 10_000)]
  );

  assert.equal(audit.rows[0].expectedBonus, 5_000);
  assert.ok(audit.rows[0].issues.includes(AUDIT_ISSUE.FOUND_WD));
  assert.ok(audit.rows[0].issues.includes(AUDIT_ISSUE.OVERPAID));
  assert.equal(audit.stats.overpaid, 1);
});

test("audit accepts 500k, 1m, and 1m+ DP with a 100k bonus cap", () => {
  const fiveHundred = auditBonusPayments([row("a", 500_000)], [], [row("a", 50_000)]);
  assert.equal(fiveHundred.rows[0].status, AUDIT_STATUS.CORRECT);
  assert.equal(fiveHundred.rows[0].expectedBonus, 50_000);

  const oneMillion = auditBonusPayments([row("b", 1_000_000)], [], [row("b", 100_000)]);
  assert.equal(oneMillion.rows[0].status, AUDIT_STATUS.CORRECT);
  assert.equal(oneMillion.rows[0].expectedBonus, 100_000);

  const aboveOneMillion = auditBonusPayments([row("c", 2_000_000)], [], [row("c", 100_000)]);
  assert.equal(aboveOneMillion.rows[0].status, AUDIT_STATUS.CORRECT);
  assert.equal(aboveOneMillion.rows[0].expectedBonus, 100_000);
  assert.equal(aboveOneMillion.rulesVersion, AUDIT_RULES_VERSION);
  assert.ok(!aboveOneMillion.rows[0].issues.includes(AUDIT_ISSUE.OUT_OF_RANGE_ABOVE));
});

test("audit treats a 5,555,551 DP as capped at 100k even when WD is present", () => {
  const audit = auditBonusPayments(
    [row("big1000", 5_555_551)],
    [row("big1000", 1)],
    [row("big1000", 100_000)]
  );

  assert.equal(audit.rows[0].expectedBonus, 100_000);
  assert.deepEqual(audit.rows[0].issues, [AUDIT_ISSUE.FOUND_WD]);
  assert.ok(!audit.rows[0].issues.includes(AUDIT_ISSUE.OUT_OF_RANGE_ABOVE));
});

test("audit accepts a bonus received before WD", () => {
  const audit = auditBonusPayments(
    [row("a", 100_000, "26/08/2026 08:00")],
    [row("a", 10_000, "26/08/2026 11:00")],
    [row("a", 10_000, "26/08/2026 09:00")]
  );

  assert.equal(audit.rows[0].status, AUDIT_STATUS.CORRECT);
  assert.ok(!audit.rows[0].issues.includes(AUDIT_ISSUE.FOUND_WD));
});

test("audit rejects a bonus received after WD", () => {
  const audit = auditBonusPayments(
    [row("a", 100_000, "26/08/2026 08:00")],
    [row("a", 10_000, "26/08/2026 09:00")],
    [row("a", 10_000, "26/08/2026 11:00")]
  );

  assert.ok(audit.rows[0].issues.includes(AUDIT_ISSUE.FOUND_WD));
});

test("audit flags WD when a later transaction exists among multiple bonuses", () => {
  const audit = auditBonusPayments(
    [row("a", 200_000, "26/08/2026 08:00")],
    [row("a", 10_000, "26/08/2026 10:00")],
    [row("a", 10_000, "26/08/2026 09:00"), row("a", 10_000, "26/08/2026 11:00")]
  );

  assert.ok(audit.rows[0].issues.includes(AUDIT_ISSUE.DOUBLE_BONUS));
  assert.ok(audit.rows[0].issues.includes(AUDIT_ISSUE.FOUND_WD));
});

test("audit lists an eligible ID with no SCB bonus as missing", () => {
  const audit = auditBonusPayments([row("a", 75_000)], [], []);
  assert.equal(audit.rows[0].status, AUDIT_STATUS.MISSING);
  assert.equal(audit.rows[0].expectedBonus, 7_000);
});
