import test from "node:test";
import assert from "node:assert/strict";

import { SORT_ORDER, sortTransactions } from "../core/sort.js";

const rows = [
  { usernameKey: "user2", amount: 75_000 },
  { usernameKey: "user10", amount: 50_000 },
  { usernameKey: "user1", amount: 100_000 }
];

test("sorts IDs naturally in both directions", () => {
  assert.deepEqual(
    sortTransactions(rows, SORT_ORDER.ID_ASC).map((row) => row.usernameKey),
    ["user1", "user2", "user10"]
  );
  assert.deepEqual(
    sortTransactions(rows, SORT_ORDER.ID_DESC).map((row) => row.usernameKey),
    ["user10", "user2", "user1"]
  );
});

test("sorts DP amounts in both directions without mutating source rows", () => {
  assert.deepEqual(sortTransactions(rows, SORT_ORDER.DP_ASC).map((row) => row.amount), [50_000, 75_000, 100_000]);
  assert.deepEqual(sortTransactions(rows, SORT_ORDER.DP_DESC).map((row) => row.amount), [100_000, 75_000, 50_000]);
  assert.equal(rows[0].usernameKey, "user2");
});
