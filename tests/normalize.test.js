import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAmount, normalizeExtractedRows, normalizeUsername } from "../core/normalize.js";

test("normalizeUsername trims and compares case-insensitively", () => {
  assert.equal(normalizeUsername(" USER123 "), "user123");
  assert.equal(normalizeUsername("user123"), "user123");
});

test("normalizeAmount parses requested integer formats", () => {
  assert.equal(normalizeAmount("50000"), 50_000);
  assert.equal(normalizeAmount("50,000"), 50_000);
  assert.equal(normalizeAmount("50.000"), 50_000);
  assert.equal(normalizeAmount("Rp50.000"), 50_000);
  assert.equal(normalizeAmount("Rp 1.234.567"), 1_234_567);
});

test("normalizeAmount handles decimal notation and rejects missing values", () => {
  assert.equal(normalizeAmount("1.000,50"), 1_000.5);
  assert.equal(normalizeAmount("1,000.50"), 1_000.5);
  assert.equal(normalizeAmount(""), null);
  assert.equal(normalizeAmount("Rp -"), null);
});

test("normalizeExtractedRows reports invalid amounts without crashing", () => {
  const normalized = normalizeExtractedRows([
    { username: " UserA ", amountText: "75.000", datetime: "now" },
    { username: "userB", amountText: "not available", datetime: "later" }
  ]);

  assert.equal(normalized.invalidAmounts, 1);
  assert.deepEqual(normalized.rows, [
    { username: "UserA", usernameKey: "usera", amount: 75_000, datetime: "now" }
  ]);
});
