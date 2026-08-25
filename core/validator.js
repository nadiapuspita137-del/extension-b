export const MIN_ELIGIBLE_AMOUNT = 50_000;
export const MAX_ELIGIBLE_AMOUNT = 500_000;

export const STATUS = Object.freeze({
  BNS: "BNS",
  STOP_BNS: "STOP_BNS",
  FOUND_WD: "FOUND_WD",
  FOUND_SCB: "FOUND_SCB",
  FOUND_WD_AND_SCB: "FOUND_WD_AND_SCB"
});

export function isEligibleTransaction(transaction) {
  return (
    Number.isFinite(transaction?.amount) &&
    transaction.amount >= MIN_ELIGIBLE_AMOUNT &&
    transaction.amount < MAX_ELIGIBLE_AMOUNT
  );
}

export function validateSnapshots(dpRows, wdRows, scbRows, stopBnsRows = []) {
  const wdKeys = new Set((wdRows ?? []).map((row) => row.usernameKey).filter(Boolean));
  const scbKeys = new Set((scbRows ?? []).map((row) => row.usernameKey).filter(Boolean));
  const stopBnsKeys = new Set((stopBnsRows ?? []).map((row) => row.usernameKey).filter(Boolean));

  const stats = {
    rawDp: (dpRows ?? []).length,
    eligible: 0,
    ignoredBelowMinimum: 0,
    ignoredAtOrAboveMaximum: 0,
    invalidAmounts: 0,
    bns: 0,
    stopBns: 0,
    foundWd: 0,
    foundScb: 0,
    foundWdAndScb: 0
  };

  const results = [];

  for (const transaction of dpRows ?? []) {
    if (!Number.isFinite(transaction?.amount)) {
      stats.invalidAmounts += 1;
      continue;
    }
    if (transaction.amount < MIN_ELIGIBLE_AMOUNT) {
      stats.ignoredBelowMinimum += 1;
      continue;
    }
    if (transaction.amount >= MAX_ELIGIBLE_AMOUNT) {
      stats.ignoredAtOrAboveMaximum += 1;
      continue;
    }

    const inWd = wdKeys.has(transaction.usernameKey);
    const inScb = scbKeys.has(transaction.usernameKey);
    let status;

    if (inWd && inScb) {
      status = STATUS.FOUND_WD_AND_SCB;
      stats.foundWdAndScb += 1;
    } else if (inWd) {
      status = STATUS.FOUND_WD;
      stats.foundWd += 1;
    } else if (inScb) {
      status = STATUS.FOUND_SCB;
      stats.foundScb += 1;
    } else if (stopBnsKeys.has(transaction.usernameKey)) {
      status = STATUS.STOP_BNS;
      stats.stopBns += 1;
    } else {
      status = STATUS.BNS;
      stats.bns += 1;
    }

    stats.eligible += 1;
    results.push({ ...transaction, status });
  }

  return { results, stats };
}
