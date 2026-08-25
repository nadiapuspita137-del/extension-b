import { normalizeAmount, normalizeUsername } from "../core/normalize.js";
import { STATUS, validateSnapshots } from "../core/validator.js";
import { SORT_ORDER, sortTransactions } from "../core/sort.js";
import { configuredPageType, PANEL_URLS } from "../core/panels.js";

const output = document.querySelector("#output");
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const dp = (amount) => ({ username: "UserA", usernameKey: "usera", amount, datetime: "" });
const present = (usernameKey) => ({ username: usernameKey, usernameKey, amount: 0, datetime: "" });

check(normalizeUsername(" USERA ") === "usera", "username normalization");
check(normalizeAmount("Rp50.000") === 50_000, "amount normalization");
check(validateSnapshots([dp(49_000)], [], []).stats.eligible === 0, "49k ignored");
check(validateSnapshots([dp(50_000)], [], []).results[0].status === STATUS.BNS, "50k BNS");
check(validateSnapshots([dp(499_999)], [], []).stats.eligible === 1, "499999 eligible");
check(validateSnapshots([dp(500_000)], [], []).stats.eligible === 0, "500k ignored");
check(validateSnapshots([dp(20_000), dp(30_000)], [], []).stats.eligible === 0, "transactions not summed");
check(validateSnapshots([dp(20_000), dp(75_000)], [], []).stats.eligible === 1, "mixed eligibility");
check(
  validateSnapshots([dp(75_000)], [present("usera")], []).results[0].status === STATUS.FOUND_WD,
  "WD presence"
);
check(
  validateSnapshots([dp(75_000)], [], [present("usera")]).results[0].status === STATUS.FOUND_SCB,
  "SCB presence"
);
check(
  validateSnapshots([dp(75_000)], [present("userb")], [present("userc")]).results[0].status === STATUS.BNS,
  "unrelated presence"
);
const stopped = validateSnapshots([dp(75_000)], [], [], [present("usera")]);
check(stopped.results[0].status === STATUS.STOP_BNS, "Stop BNS exclusion");
check(stopped.stats.bns === 0 && stopped.stats.stopBns === 1, "Stop BNS stats");
check(
  validateSnapshots([dp(75_000)], [present("usera")], [], [present("usera")]).results[0].status === STATUS.FOUND_WD,
  "WD presence precedes Stop BNS"
);
const sortable = [
  { usernameKey: "user2", amount: 75_000 },
  { usernameKey: "user10", amount: 50_000 },
  { usernameKey: "user1", amount: 100_000 }
];
check(sortTransactions(sortable, SORT_ORDER.ID_DESC)[0].usernameKey === "user10", "ID descending sort");
check(sortTransactions(sortable, SORT_ORDER.DP_ASC)[0].amount === 50_000, "DP ascending sort");
check(configuredPageType(PANEL_URLS.DP) === "DP", "one-click DP URL mapping");
check(configuredPageType(PANEL_URLS.WD) === "WD", "one-click WD URL mapping");
check(configuredPageType(PANEL_URLS.SCB) === "SCB", "one-click SCB URL mapping");

let scannerListener;
globalThis.chrome.runtime = {
  onMessage: {
    addListener(callback) {
      scannerListener = callback;
    }
  }
};

const table = document.createElement("table");
table.id = "AddCreditHistory_cm1_g";
const populateTable = (rows) => {
  table.replaceChildren();
  for (const values of rows) {
    const row = table.insertRow();
    for (const value of values) row.insertCell().textContent = value;
  }
};
populateTable([
  ["Date/Time", "Deposit", "RRN", "User Name"],
  ["25/08/2026", "75.000", "ref-1", "UserA"]
]);
document.body.appendChild(table);

await new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "../content/scanner.js";
  script.onload = resolve;
  script.onerror = () => reject(new Error("scanner script failed to load"));
  document.head.appendChild(script);
});

let scannerResponse;
scannerListener({ type: "BNS_SCAN_CURRENT_PAGE" }, null, (value) => { scannerResponse = value; });
check(scannerResponse?.pageType === "DP", "DP page detection");
check(scannerResponse?.rows?.[0]?.username === "UserA", "header-driven row extraction");
check(scannerResponse?.source?.columns?.amount === 1, "dynamic amount column mapping");

populateTable([
  ["Account Number", "Withdraw Amount", "User Name", "Date/Time"],
  ["123", "100.000", "UserB", "25/08/2026"]
]);
scannerListener({ type: "BNS_SCAN_CURRENT_PAGE" }, null, (value) => { scannerResponse = value; });
check(scannerResponse?.pageType === "WD", "WD page detection");
check(scannerResponse?.rows?.[0]?.amountText === "100.000", "WD amount extraction");

populateTable([
  ["User Name", "Edited By", "Deposit", "Date/Time"],
  ["UserC", "staff", "125.000", "25/08/2026"]
]);
scannerListener({ type: "BNS_SCAN_CURRENT_PAGE" }, null, (value) => { scannerResponse = value; });
check(scannerResponse?.pageType === "SCB", "SCB page detection");

populateTable([["User Name", "Withdraw Amount", "Date/Time"]]);
scannerListener({ type: "BNS_SCAN_CURRENT_PAGE" }, null, (value) => { scannerResponse = value; });
check(scannerResponse?.ok === true && scannerResponse?.empty === true, "captured-but-empty snapshot");
table.remove();

document.body.dataset.status = failures.length ? "fail" : "pass";
output.textContent = failures.length ? `FAIL\n${failures.join("\n")}` : "PASS: core + scanner browser smoke tests";
