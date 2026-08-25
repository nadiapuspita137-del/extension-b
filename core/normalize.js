export function normalizeUsername(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("id-ID");
}

function normalizeBankText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function isDailyBonusToBank(value) {
  const text = normalizeBankText(value);
  return /\bscb a bonus deposit harian(?:\s+01)?\b/.test(text);
}

export function isManualDepositToBank(value) {
  const text = normalizeBankText(value);
  return Boolean(text) && !/^scb(?:\s|\-|$)/.test(text);
}

/**
 * Parse an amount without guessing a fixed locale.
 * Repeated groups of three digits are treated as thousand separators, while
 * a final group of one or two digits is treated as a decimal fraction.
 */
export function normalizeAmount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  let source = String(value ?? "").trim();
  if (!source) return null;

  const isParenthesizedNegative = /^\s*\(.*\)\s*$/.test(source);
  const hasMinus = /-/.test(source);
  source = source.replace(/[^\d.,]/g, "");

  if (!/\d/.test(source)) return null;

  const dotCount = (source.match(/\./g) || []).length;
  const commaCount = (source.match(/,/g) || []).length;
  let normalized;

  if (dotCount && commaCount) {
    const lastDot = source.lastIndexOf(".");
    const lastComma = source.lastIndexOf(",");
    const decimalIndex = Math.max(lastDot, lastComma);
    const fractionLength = source.length - decimalIndex - 1;

    if (fractionLength === 1 || fractionLength === 2) {
      const integerPart = source.slice(0, decimalIndex).replace(/[.,]/g, "");
      const fractionPart = source.slice(decimalIndex + 1);
      normalized = `${integerPart}.${fractionPart}`;
    } else {
      normalized = source.replace(/[.,]/g, "");
    }
  } else if (dotCount || commaCount) {
    const separator = dotCount ? "." : ",";
    const parts = source.split(separator);
    const looksLikeThousands =
      parts.length > 1 &&
      parts.slice(1).every((part) => part.length === 3) &&
      parts.every((part) => /^\d+$/.test(part));

    if (looksLikeThousands) {
      normalized = parts.join("");
    } else if (parts.length === 2 && /^[0-9]+$/.test(parts[0]) && /^[0-9]{1,2}$/.test(parts[1])) {
      normalized = `${parts[0]}.${parts[1]}`;
    } else {
      normalized = parts.join("");
    }
  } else {
    normalized = source;
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return isParenthesizedNegative || hasMinus ? -amount : amount;
}

export function normalizeExtractedRows(rawRows) {
  const rows = [];
  let invalidAmounts = 0;

  for (const rawRow of rawRows ?? []) {
    const username = String(rawRow.username ?? "").trim();
    const usernameKey = normalizeUsername(username);
    const amount = normalizeAmount(rawRow.amountText);

    if (!usernameKey) continue;
    if (amount === null) {
      invalidAmounts += 1;
      continue;
    }

    rows.push({
      username,
      usernameKey,
      amount,
      datetime: String(rawRow.datetime ?? "").trim(),
      reference: String(rawRow.reference ?? "").trim(),
      rrn: String(rawRow.rrn ?? "").trim(),
      toBank: String(rawRow.toBank ?? "").trim(),
      rowNumber: String(rawRow.rowNumber ?? "").trim()
    });
  }

  return { rows, invalidAmounts };
}
