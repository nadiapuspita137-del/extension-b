import test from "node:test";
import assert from "node:assert/strict";

import { STATUS, validateSnapshots } from "../core/validator.js";

const dp = (username, amount) => ({ username, usernameKey: username.toLowerCase(), amount, datetime: "" });
const presence = (username) => ({ username, usernameKey: username.toLowerCase(), amount: 0, datetime: "" });

function validate(dpRows, wdRows = [], scbRows = []) {
  return validateSnapshots(dpRows, wdRows, scbRows);
}

test("Case 1: DP 49.000 is ignored", () => {
  const result = validate([dp("userA", 49_000)]);
  assert.equal(result.stats.eligible, 0);
  assert.equal(result.stats.ignoredBelowMinimum, 1);
});

test("Case 2: DP 50.000 is BNS when WD and SCB are empty", () => {
  const result = validate([dp("userA", 50_000)]);
  assert.equal(result.results[0].status, STATUS.BNS);
});

test("Case 3: DP 499.999 is eligible", () => {
  assert.equal(validate([dp("userA", 499_999)]).stats.eligible, 1);
});

test("Case 4: DP 500.000 is ignored", () => {
  const result = validate([dp("userA", 500_000)]);
  assert.equal(result.stats.eligible, 0);
  assert.equal(result.stats.ignoredAtOrAboveMaximum, 1);
});

test("Case 5: separate DP 20.000 and 30.000 are never summed", () => {
  assert.equal(validate([dp("userA", 20_000), dp("userA", 30_000)]).stats.eligible, 0);
});

test("Case 6: only DP 75.000 is eligible among two transactions", () => {
  const result = validate([dp("userA", 20_000), dp("userA", 75_000)]);
  assert.equal(result.stats.eligible, 1);
  assert.equal(result.results[0].amount, 75_000);
});

test("Case 7: username present in WD is FOUND_WD", () => {
  const result = validate([dp("userA", 75_000)], [presence("USERA")]);
  assert.equal(result.results[0].status, STATUS.FOUND_WD);
});

test("Case 8: username present in SCB is FOUND_SCB", () => {
  const result = validate([dp("userA", 75_000)], [], [presence("USERA")]);
  assert.equal(result.results[0].status, STATUS.FOUND_SCB);
});

test("Case 9: unrelated WD and SCB usernames leave transaction as BNS", () => {
  const result = validate(
    [dp("userA", 75_000)],
    [presence("userB")],
    [presence("userC")]
  );
  assert.equal(result.results[0].status, STATUS.BNS);
});

test("duplicate eligible DP transactions remain separate", () => {
  const result = validate([dp("userA", 75_000), dp("userA", 100_000)]);
  assert.equal(result.results.length, 2);
  assert.equal(result.stats.bns, 2);
});

test("presence in both datasets gets an explicit combined status", () => {
  const result = validate(
    [dp("userA", 75_000)],
    [presence("userA")],
    [presence("userA")]
  );
  assert.equal(result.results[0].status, STATUS.FOUND_WD_AND_SCB);
  assert.equal(result.stats.foundWdAndScb, 1);
});

test("Stop BNS excludes an otherwise-BNS ID without removing the transaction", () => {
  const result = validateSnapshots(
    [dp("userA", 75_000)],
    [],
    [],
    [presence("USERA")]
  );
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, STATUS.STOP_BNS);
  assert.equal(result.stats.bns, 0);
  assert.equal(result.stats.stopBns, 1);
});

test("WD/SCB presence takes precedence over Stop BNS", () => {
  const result = validateSnapshots(
    [dp("userA", 75_000)],
    [presence("userA")],
    [],
    [presence("userA")]
  );
  assert.equal(result.results[0].status, STATUS.FOUND_WD);
  assert.equal(result.stats.stopBns, 0);
});
