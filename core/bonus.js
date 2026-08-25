export const BONUS_RATE = 0.10;
export const BONUS_CAP = 100_000;
export const BONUS_ROUNDING_UNIT = 1_000;
export const MIN_BONUS_DP = 50_000;
export const MAX_BONUS_DP = 500_000;

export const BONUS_STATUS = Object.freeze({
  READY: "READY",
  FOUND_WD: "FOUND_WD",
  ALREADY_IN_HISTORY: "ALREADY_IN_HISTORY",
  FOUND_WD_AND_HISTORY: "FOUND_WD_AND_HISTORY",
  STOP_BNS: "STOP_BNS",
  OUT_OF_RANGE_BELOW: "OUT_OF_RANGE_BELOW",
  OUT_OF_RANGE_ABOVE: "OUT_OF_RANGE_ABOVE"
});

export function calculateBonus(amount) {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const rawBonus = amount * BONUS_RATE;
  const roundedDown = Math.floor(rawBonus / BONUS_ROUNDING_UNIT) * BONUS_ROUNDING_UNIT;
  return Math.min(roundedDown, BONUS_CAP);
}

export function extractPanelDate(datetime) {
  const value = String(datetime ?? "").trim();
  let match = value.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  match = value.match(/\b(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }
  return "";
}

export function buildBonusQueue(dpRows, wdRows, scbRows, stopBnsRows = []) {
  const wdKeys = new Set((wdRows ?? []).map((row) => row.usernameKey).filter(Boolean));
  const historyKeys = new Set((scbRows ?? []).map((row) => row.usernameKey).filter(Boolean));
  const stopKeys = new Set((stopBnsRows ?? []).map((row) => row.usernameKey).filter(Boolean));
  const groups = new Map();

  for (const transaction of dpRows ?? []) {
    if (!transaction?.usernameKey || !Number.isFinite(transaction.amount)) continue;
    let group = groups.get(transaction.usernameKey);
    if (!group) {
      group = {
        username: transaction.username,
        usernameKey: transaction.usernameKey,
        transactionCount: 0,
        maximumTransaction: transaction
      };
      groups.set(transaction.usernameKey, group);
    }
    group.transactionCount += 1;
    if (transaction.amount > group.maximumTransaction.amount) {
      group.maximumTransaction = transaction;
      group.username = transaction.username;
    }
  }

  const stats = {
    uniqueDp: groups.size,
    inRange: 0,
    ready: 0,
    foundWd: 0,
    alreadyInHistory: 0,
    foundWdAndHistory: 0,
    stopBns: 0,
    outOfRangeBelow: 0,
    outOfRangeAbove: 0
  };
  const rows = [];

  for (const group of groups.values()) {
    const maximum = group.maximumTransaction;
    const inWd = wdKeys.has(group.usernameKey);
    const inHistory = historyKeys.has(group.usernameKey);
    let status;
    let bonusAmount = null;

    if (maximum.amount < MIN_BONUS_DP) {
      status = BONUS_STATUS.OUT_OF_RANGE_BELOW;
      stats.outOfRangeBelow += 1;
    } else if (maximum.amount >= MAX_BONUS_DP) {
      status = BONUS_STATUS.OUT_OF_RANGE_ABOVE;
      stats.outOfRangeAbove += 1;
    } else {
      stats.inRange += 1;
      bonusAmount = calculateBonus(maximum.amount);
      if (inWd && inHistory) {
        status = BONUS_STATUS.FOUND_WD_AND_HISTORY;
        stats.foundWdAndHistory += 1;
      } else if (inWd) {
        status = BONUS_STATUS.FOUND_WD;
        stats.foundWd += 1;
      } else if (inHistory) {
        status = BONUS_STATUS.ALREADY_IN_HISTORY;
        stats.alreadyInHistory += 1;
      } else if (stopKeys.has(group.usernameKey)) {
        status = BONUS_STATUS.STOP_BNS;
        stats.stopBns += 1;
      } else {
        status = BONUS_STATUS.READY;
        stats.ready += 1;
      }
    }

    rows.push({
      username: group.username,
      usernameKey: group.usernameKey,
      amount: maximum.amount,
      maximumDp: maximum.amount,
      bonusAmount,
      datetime: maximum.datetime,
      businessDate: extractPanelDate(maximum.datetime),
      transactionCount: group.transactionCount,
      status
    });
  }

  return { rows, stats };
}
