import test from "node:test";
import assert from "node:assert/strict";

import { BONUS_STATUS, buildBonusQueue, calculateBonus } from "../core/bonus.js";

const dp = (username, amount, datetime = "25/08/2026 12:00") => ({
  username,
  usernameKey: username.toLowerCase(),
  amount,
  datetime
});
const presence = (username) => ({ username, usernameKey: username.toLowerCase(), amount: 0, datetime: "" });

test("bonus is ten percent rounded down to whole thousands", () => {
  assert.equal(calculateBonus(50_000), 5_000);
  assert.equal(calculateBonus(55_000), 5_000);
  assert.equal(calculateBonus(75_000), 7_000);
  assert.equal(calculateBonus(155_000), 15_000);
  assert.equal(calculateBonus(499_999), 49_000);
});

test("uses the largest DP once per unique ID", () => {
  const queue = buildBonusQueue([dp("userA", 50_000), dp("userA", 300_000)], [], []);
  assert.equal(queue.rows.length, 1);
  assert.equal(queue.rows[0].maximumDp, 300_000);
  assert.equal(queue.rows[0].bonusAmount, 30_000);
  assert.equal(queue.rows[0].transactionCount, 2);
  assert.equal(queue.rows[0].status, BONUS_STATUS.READY);
});

test("largest DP outside the range disqualifies the whole ID", () => {
  const queue = buildBonusQueue([dp("userA", 75_000), dp("userA", 600_000)], [], []);
  assert.equal(queue.rows[0].maximumDp, 600_000);
  assert.equal(queue.rows[0].bonusAmount, null);
  assert.equal(queue.rows[0].status, BONUS_STATUS.OUT_OF_RANGE_ABOVE);
  assert.equal(queue.stats.ready, 0);
});

test("largest DP in range qualifies even when another transaction is below range", () => {
  const queue = buildBonusQueue([dp("userA", 20_000), dp("userA", 300_000)], [], []);
  assert.equal(queue.rows[0].status, BONUS_STATUS.READY);
  assert.equal(queue.rows[0].bonusAmount, 30_000);
});

test("history, WD, and Stop BNS exclude an in-range ID", () => {
  const rows = [dp("wdUser", 100_000), dp("historyUser", 200_000), dp("stopUser", 300_000)];
  const queue = buildBonusQueue(
    rows,
    [presence("wdUser")],
    [presence("historyUser")],
    [presence("stopUser")]
  );
  const statuses = new Map(queue.rows.map((row) => [row.usernameKey, row.status]));
  assert.equal(statuses.get("wduser"), BONUS_STATUS.FOUND_WD);
  assert.equal(statuses.get("historyuser"), BONUS_STATUS.ALREADY_IN_HISTORY);
  assert.equal(statuses.get("stopuser"), BONUS_STATUS.STOP_BNS);
});
