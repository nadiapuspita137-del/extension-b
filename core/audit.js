import { calculateBonus } from "./bonus.js";

// Bonus Audit intentionally has a wider range than Validation/Bonus Queue.
// At 1,000,000 DP the 10% bonus reaches its 100,000 cap; larger DP values
// remain auditable at the same capped bonus.
export const AUDIT_MIN_DP = 50_000;
export const AUDIT_FULL_BONUS_DP = 1_000_000;
export const AUDIT_RULES_VERSION = "min-50k-no-upper-cap-100k-wd-order-v2";

export const AUDIT_STATUS = Object.freeze({
  CORRECT: "CORRECT",
  ISSUE: "ISSUE",
  MISSING: "MISSING"
});

export const AUDIT_ISSUE = Object.freeze({
  DOUBLE_BONUS: "DOUBLE_BONUS",
  OVERPAID: "OVERPAID",
  UNDERPAID: "UNDERPAID",
  NO_DP: "NO_DP",
  OUT_OF_RANGE_BELOW: "OUT_OF_RANGE_BELOW",
  OUT_OF_RANGE_ABOVE: "OUT_OF_RANGE_ABOVE",
  FOUND_WD: "FOUND_WD",
  STOP_BNS: "STOP_BNS",
  MISSING_BONUS: "MISSING_BONUS"
});

function groupRows(rows) {
  const groups = new Map();
  for (const row of rows ?? []) {
    if (!row?.usernameKey || !Number.isFinite(row.amount)) continue;
    let group = groups.get(row.usernameKey);
    if (!group) {
      group = { username: row.username, usernameKey: row.usernameKey, rows: [] };
      groups.set(row.usernameKey, group);
    }
    group.rows.push(row);
    if (!group.username && row.username) group.username = row.username;
  }
  return groups;
}

export function parseAuditTimestamp(value) {
  const text = String(value ?? "").trim();
  let match = text.match(
    /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\b/
  );
  if (match) {
    return Date.UTC(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] ?? 0),
      Number(match[5] ?? 0),
      Number(match[6] ?? 0)
    );
  }

  match = text.match(
    /\b(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\b/
  );
  if (!match) return null;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0)
  );
}

function wdPrecedesBonus(wdRows, bonusRows) {
  if (!wdRows?.length || !bonusRows?.length) return false;
  const wdTimes = wdRows.map((row) => parseAuditTimestamp(row.datetime));
  const bonusTimes = bonusRows.map((row) => parseAuditTimestamp(row.datetime));

  // Missing/invalid timestamps cannot prove that the bonus preceded WD.
  if (wdTimes.some((time) => time === null) || bonusTimes.some((time) => time === null)) return true;

  const firstWd = Math.min(...wdTimes);
  const lastBonus = Math.max(...bonusTimes);
  return firstWd <= lastBonus;
}

export function auditBonusPayments(dpRows, wdRows, scbRows, stopBnsRows = []) {
  const dpGroups = groupRows(dpRows);
  const scbGroups = groupRows(scbRows);
  const wdGroups = groupRows(wdRows);
  const stopKeys = new Set((stopBnsRows ?? []).map((row) => row.usernameKey).filter(Boolean));
  const usernameKeys = new Set([...dpGroups.keys(), ...scbGroups.keys()]);
  const rows = [];

  for (const usernameKey of usernameKeys) {
    const dpGroup = dpGroups.get(usernameKey);
    const actualGroup = scbGroups.get(usernameKey);
    const wdGroup = wdGroups.get(usernameKey);
    const maximumDp = dpGroup?.rows.reduce((maximum, row) => Math.max(maximum, row.amount), -Infinity) ?? null;
    const inRange = Number.isFinite(maximumDp) && maximumDp >= AUDIT_MIN_DP;
    const hasWd = Boolean(wdGroup);
    const foundWd = wdPrecedesBonus(wdGroup?.rows, actualGroup?.rows);
    const stopped = stopKeys.has(usernameKey);
    const shouldReceive = inRange && !hasWd && !stopped;
    // Keep the nominal check independent from eligibility exclusions. An ID
    // can violate the WD/Stop BNS rule and still have an over/under payment
    // compared with the bonus amount implied by its DP.
    const expectedBonus = inRange ? calculateBonus(maximumDp) : null;
    const actualAmounts = actualGroup?.rows.map((row) => row.amount) ?? [];
    const actualTotal = actualAmounts.reduce((total, amount) => total + amount, 0);
    const issues = [];

    if (actualAmounts.length > 0) {
      if (actualAmounts.length > 1) issues.push(AUDIT_ISSUE.DOUBLE_BONUS);
      if (!dpGroup) issues.push(AUDIT_ISSUE.NO_DP);
      else if (maximumDp < AUDIT_MIN_DP) issues.push(AUDIT_ISSUE.OUT_OF_RANGE_BELOW);
      if (foundWd) issues.push(AUDIT_ISSUE.FOUND_WD);
      if (stopped) issues.push(AUDIT_ISSUE.STOP_BNS);
      if (inRange && actualTotal > expectedBonus) issues.push(AUDIT_ISSUE.OVERPAID);
      if (inRange && actualTotal < expectedBonus) issues.push(AUDIT_ISSUE.UNDERPAID);
    } else if (shouldReceive) {
      issues.push(AUDIT_ISSUE.MISSING_BONUS);
    } else {
      continue;
    }

    const status = issues.length === 0
      ? AUDIT_STATUS.CORRECT
      : issues.includes(AUDIT_ISSUE.MISSING_BONUS)
        ? AUDIT_STATUS.MISSING
        : AUDIT_STATUS.ISSUE;
    rows.push({
      username: dpGroup?.username || actualGroup?.username || usernameKey,
      usernameKey,
      maximumDp: Number.isFinite(maximumDp) ? maximumDp : null,
      amount: Number.isFinite(maximumDp) ? maximumDp : 0,
      expectedBonus,
      actualTotal,
      actualAmounts,
      actualTransactionCount: actualAmounts.length,
      dpTransactionCount: dpGroup?.rows.length ?? 0,
      status,
      issues
    });
  }

  const stats = {
    audited: rows.length,
    correct: 0,
    issueRows: 0,
    missing: 0,
    doubleBonus: 0,
    overpaid: 0,
    underpaid: 0,
    noDp: 0,
    outOfRange: 0,
    foundWd: 0,
    stopBns: 0,
    ruleViolations: 0,
    expectedTotal: 0,
    actualTotal: 0
  };
  for (const row of rows) {
    if (row.status === AUDIT_STATUS.CORRECT) stats.correct += 1;
    if (row.status === AUDIT_STATUS.ISSUE) stats.issueRows += 1;
    if (row.status === AUDIT_STATUS.MISSING) stats.missing += 1;
    if (row.issues.includes(AUDIT_ISSUE.DOUBLE_BONUS)) stats.doubleBonus += 1;
    if (row.issues.includes(AUDIT_ISSUE.OVERPAID)) stats.overpaid += 1;
    if (row.issues.includes(AUDIT_ISSUE.UNDERPAID)) stats.underpaid += 1;
    if (row.issues.includes(AUDIT_ISSUE.NO_DP)) stats.noDp += 1;
    if (row.issues.some((issue) => [AUDIT_ISSUE.OUT_OF_RANGE_BELOW, AUDIT_ISSUE.OUT_OF_RANGE_ABOVE].includes(issue))) {
      stats.outOfRange += 1;
    }
    if (row.issues.includes(AUDIT_ISSUE.FOUND_WD)) stats.foundWd += 1;
    if (row.issues.includes(AUDIT_ISSUE.STOP_BNS)) stats.stopBns += 1;
    if (row.issues.some((issue) => [
      AUDIT_ISSUE.NO_DP,
      AUDIT_ISSUE.OUT_OF_RANGE_BELOW,
      AUDIT_ISSUE.OUT_OF_RANGE_ABOVE,
      AUDIT_ISSUE.FOUND_WD,
      AUDIT_ISSUE.STOP_BNS
    ].includes(issue))) stats.ruleViolations += 1;
    stats.expectedTotal += row.expectedBonus ?? 0;
    stats.actualTotal += row.actualTotal;
  }
  stats.difference = stats.actualTotal - stats.expectedTotal;
  return { rulesVersion: AUDIT_RULES_VERSION, rows, stats };
}
