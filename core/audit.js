import {
  calculateBonus,
  MAX_BONUS_DP,
  MIN_BONUS_DP
} from "./bonus.js";

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

export function auditBonusPayments(dpRows, wdRows, scbRows, stopBnsRows = []) {
  const dpGroups = groupRows(dpRows);
  const scbGroups = groupRows(scbRows);
  const wdKeys = new Set((wdRows ?? []).map((row) => row.usernameKey).filter(Boolean));
  const stopKeys = new Set((stopBnsRows ?? []).map((row) => row.usernameKey).filter(Boolean));
  const usernameKeys = new Set([...dpGroups.keys(), ...scbGroups.keys()]);
  const rows = [];

  for (const usernameKey of usernameKeys) {
    const dpGroup = dpGroups.get(usernameKey);
    const actualGroup = scbGroups.get(usernameKey);
    const maximumDp = dpGroup?.rows.reduce((maximum, row) => Math.max(maximum, row.amount), -Infinity) ?? null;
    const inRange = Number.isFinite(maximumDp) && maximumDp >= MIN_BONUS_DP && maximumDp < MAX_BONUS_DP;
    const foundWd = wdKeys.has(usernameKey);
    const stopped = stopKeys.has(usernameKey);
    const shouldReceive = inRange && !foundWd && !stopped;
    const expectedBonus = shouldReceive ? calculateBonus(maximumDp) : null;
    const actualAmounts = actualGroup?.rows.map((row) => row.amount) ?? [];
    const actualTotal = actualAmounts.reduce((total, amount) => total + amount, 0);
    const issues = [];

    if (actualAmounts.length > 0) {
      if (actualAmounts.length > 1) issues.push(AUDIT_ISSUE.DOUBLE_BONUS);
      if (!dpGroup) issues.push(AUDIT_ISSUE.NO_DP);
      else if (maximumDp < MIN_BONUS_DP) issues.push(AUDIT_ISSUE.OUT_OF_RANGE_BELOW);
      else if (maximumDp >= MAX_BONUS_DP) issues.push(AUDIT_ISSUE.OUT_OF_RANGE_ABOVE);
      if (foundWd) issues.push(AUDIT_ISSUE.FOUND_WD);
      if (stopped) issues.push(AUDIT_ISSUE.STOP_BNS);
      if (shouldReceive && actualTotal > expectedBonus) issues.push(AUDIT_ISSUE.OVERPAID);
      if (shouldReceive && actualTotal < expectedBonus) issues.push(AUDIT_ISSUE.UNDERPAID);
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
  return { rows, stats };
}
