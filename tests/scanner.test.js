import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const scannerCode = await readFile(new URL("../content/scanner.js", import.meta.url), "utf8");

function makeRow(values) {
  return {
    cells: values.map((value) => ({ innerText: value, textContent: value }))
  };
}

function scan({ headers, values, tableId = "AddCreditHistory_cm1_g", url, action }) {
  let listener;
  const table = { id: tableId, rows: [makeRow(headers), makeRow(values)] };
  const form = {
    action,
    getAttribute(name) {
      return name === "action" ? action : null;
    }
  };
  const context = vm.createContext({
    location: { href: url },
    document: {
      forms: action ? [form] : [],
      querySelectorAll(selector) {
        return selector === "table" ? [table] : [];
      }
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(callback) {
            listener = callback;
          }
        }
      }
    }
  });

  vm.runInContext(scannerCode, context);
  let response;
  listener({ type: "BNS_SCAN_CURRENT_PAGE" }, null, (value) => {
    response = value;
  });
  return response;
}

test("DP detection uses IsABD/RRN and extracts by header name, not fixed index", () => {
  const response = scan({
    headers: ["Date/Time", "Deposit", "RRN", "User Name"],
    values: ["25/08/2026 12:30", "Rp50.000", "abc", " UserA "],
    url: "https://panel.example/AddCreditHistory2.aspx?IsABD=1",
    action: "./AddCreditHistory2.aspx?IsABD=1"
  });

  assert.equal(response.ok, true);
  assert.equal(response.pageType, "DP");
  assert.deepEqual({ ...response.rows[0] }, {
    username: "UserA",
    amountText: "Rp50.000",
    datetime: "25/08/2026 12:30",
    reference: "",
    rrn: "abc",
    toBank: "",
    rowNumber: ""
  });
  assert.deepEqual(
    { ...response.source.columns },
    { username: 3, amount: 1, datetime: 0, reference: -1, rrn: 2, toBank: -1 }
  );
});

test("SCB detection uses Edited By and AddCreditHistory action", () => {
  const response = scan({
    headers: ["User Name", "To Bank", "Edited By", "Date/Time", "Deposit"],
    values: ["userB", "SCB\nSCB A BONUS DEPOSIT HARIAN\n01", "staff", "25/08/2026", "75,000"],
    url: "https://panel.example/AddCreditHistory2.aspx",
    action: "./AddCreditHistory2.aspx"
  });

  assert.equal(response.pageType, "SCB");
  assert.equal(response.rows[0].username, "userB");
  assert.match(response.rows[0].toBank, /BONUS DEPOSIT HARIAN/);
});

test("WD detection prefers Withdraw Amount header", () => {
  const response = scan({
    headers: ["Account Number", "Withdraw Amount", "User Name", "Date/Time"],
    values: ["123", "100.000", "userC", "25/08/2026"],
    url: "https://panel.example/WashCreditHistory.aspx",
    action: "./WashCreditHistory.aspx"
  });

  assert.equal(response.pageType, "WD");
  assert.equal(response.rows[0].amountText, "100.000");
});

test("a recognized empty table remains a captured-but-empty dataset", () => {
  let listener;
  const table = { id: "AddCreditHistory_cm1_g", rows: [makeRow(["User Name", "Withdraw Amount"])] };
  const context = vm.createContext({
    location: { href: "https://panel.example/WashCreditHistory.aspx" },
    document: { forms: [], querySelectorAll: () => [table] },
    chrome: { runtime: { onMessage: { addListener: (callback) => { listener = callback; } } } }
  });
  vm.runInContext(scannerCode, context);
  let response;
  listener({ type: "BNS_SCAN_CURRENT_PAGE" }, null, (value) => { response = value; });

  assert.equal(response.ok, true);
  assert.equal(response.empty, true);
  assert.equal(response.message, "No transaction rows found.");
});
