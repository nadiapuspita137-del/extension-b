const idCollator = new Intl.Collator("id-ID", { numeric: true, sensitivity: "base" });

export const SORT_ORDER = Object.freeze({
  ORIGINAL: "ORIGINAL",
  ID_ASC: "ID_ASC",
  ID_DESC: "ID_DESC",
  DP_ASC: "DP_ASC",
  DP_DESC: "DP_DESC"
});

export function sortTransactions(transactions, order = SORT_ORDER.ORIGINAL) {
  const sorted = (transactions ?? []).slice();
  const compareId = (a, b) => idCollator.compare(a.usernameKey, b.usernameKey);
  const compareAmount = (a, b) => a.amount - b.amount || compareId(a, b);

  if (order === SORT_ORDER.ID_ASC) sorted.sort(compareId);
  else if (order === SORT_ORDER.ID_DESC) sorted.sort((a, b) => -compareId(a, b));
  else if (order === SORT_ORDER.DP_ASC) sorted.sort(compareAmount);
  else if (order === SORT_ORDER.DP_DESC) sorted.sort((a, b) => -compareAmount(a, b));
  return sorted;
}
