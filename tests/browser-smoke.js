import {
  isDailyBonusToBank,
  isManualDepositToBank,
  normalizeAmount,
  normalizeUsername
} from "../core/normalize.js";
import { STATUS, validateSnapshots } from "../core/validator.js";
import { SORT_ORDER, sortTransactions } from "../core/sort.js";
import { configuredPageType, PANEL_URLS } from "../core/panels.js";
import { BONUS_STATUS, buildBonusQueue, calculateBonus } from "../core/bonus.js";
import { mergePageResponses } from "../core/pagination.js";
import { AUDIT_ISSUE, AUDIT_STATUS, auditBonusPayments } from "../core/audit.js";

const output = document.querySelector("#output");
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const dp = (amount) => ({ username: "UserA", usernameKey: "usera", amount, datetime: "" });
const present = (usernameKey) => ({ username: usernameKey, usernameKey, amount: 0, datetime: "" });

check(normalizeUsername(" USERA ") === "usera", "username normalization");
check(normalizeAmount("Rp50.000") === 50_000, "amount normalization");
check(isDailyBonusToBank("SCB\nSCB A BONUS DEPOSIT HARIAN\n01"), "SCB daily bonus To Bank filter");
check(!isDailyBonusToBank("SCB\nSCB B BONUS MEMBER BARU\n02"), "other SCB bank is excluded");
check(isManualDepositToBank("PrabuPay\nbolapelangi2_oauser\n90af"), "manual deposit To Bank filter");
check(!isManualDepositToBank("SCB\nSCB A BONUS DEPOSIT HARIAN\n01"), "daily bonus is not manual DP");
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
check(calculateBonus(75_000) === 7_000, "bonus rounded down to thousands");
const bonusQueue = buildBonusQueue([dp(75_000), dp(600_000)], [], []);
check(bonusQueue.rows.length === 1, "one bonus row per unique ID");
check(bonusQueue.rows[0].status === BONUS_STATUS.OUT_OF_RANGE_ABOVE, "largest out-of-range DP disqualifies ID");
const correctAudit = auditBonusPayments([dp(300_000)], [], [present("usera")].map((item) => ({ ...item, amount: 30_000 })));
check(correctAudit.rows[0].status === AUDIT_STATUS.CORRECT, "matching bonus audit");
const doubleAudit = auditBonusPayments(
  [dp(300_000)],
  [],
  [{ ...present("usera"), amount: 30_000 }, { ...present("usera"), amount: 30_000 }]
);
check(doubleAudit.rows[0].issues.includes(AUDIT_ISSUE.DOUBLE_BONUS), "double bonus audit");
check(doubleAudit.rows[0].issues.includes(AUDIT_ISSUE.OVERPAID), "overpaid bonus audit");
const missingAudit = auditBonusPayments([dp(75_000)], [], []);
check(missingAudit.rows[0].status === AUDIT_STATUS.MISSING, "missing bonus audit");
const mergedPages = mergePageResponses([
  { rows: [{ username: "a", rrn: "r1" }], sourceRowCount: 1, pagination: { totalRecords: 2 }, source: {} },
  { rows: [{ username: "b", rrn: "r2" }], sourceRowCount: 1, pagination: {}, source: {} }
]);
check(mergedPages.rows.length === 2 && mergedPages.pagination.pagesScanned === 2, "multi-page response merge");

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
const recordSummary = document.createElement("p");
recordSummary.textContent = "Total Records: 1,009";
const pager = document.createElement("div");
pager.append("Page ");
const pageInput = document.createElement("input");
pageInput.id = "AddCreditHistory_cm1_txtPgNum";
pageInput.value = "1";
pager.append(pageInput, " of 2");
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
document.body.append(recordSummary, pager);

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
check(scannerResponse?.pagination?.currentPage === 1, "pagination current page detection");
check(scannerResponse?.pagination?.totalPages === 2, "pagination total page detection");
check(scannerResponse?.pagination?.totalRecords === 1_009, "pagination total record detection");

populateTable([
  ["Account Number", "Withdraw Amount", "User Name", "Date/Time"],
  ["123", "100.000", "UserB", "25/08/2026"]
]);
scannerListener({ type: "BNS_SCAN_CURRENT_PAGE" }, null, (value) => { scannerResponse = value; });
check(scannerResponse?.pageType === "WD", "WD page detection");
check(scannerResponse?.rows?.[0]?.amountText === "100.000", "WD amount extraction");

populateTable([
  ["User Name", "To Bank", "Edited By", "Deposit", "Date/Time"],
  ["UserC", "SCB\nSCB A BONUS DEPOSIT HARIAN\n01", "staff", "125.000", "25/08/2026"]
]);
scannerListener({ type: "BNS_SCAN_CURRENT_PAGE" }, null, (value) => { scannerResponse = value; });
check(scannerResponse?.pageType === "SCB", "SCB page detection");
check(scannerResponse?.rows?.[0]?.toBank.includes("BONUS DEPOSIT HARIAN"), "SCB To Bank extraction");

populateTable([["User Name", "Withdraw Amount", "Date/Time"]]);
scannerListener({ type: "BNS_SCAN_CURRENT_PAGE" }, null, (value) => { scannerResponse = value; });
check(scannerResponse?.ok === true && scannerResponse?.empty === true, "captured-but-empty snapshot");
table.remove();
recordSummary.remove();
pager.remove();

const botMessages = [];
globalThis.chrome.runtime.sendMessage = async (message) => {
  botMessages.push(message.type);
  if (message.type === "BNS_BOT_GET_STATE") {
    return {
      ok: true,
      authorized: true,
      state: {
        active: true,
        stage: "NAVIGATING",
        current: {
          username: "BFJ@Nia303",
          usernameKey: "bfj@nia303",
          bonusAmount: 30_000
        }
      }
    };
  }
  return { ok: true };
};

const searchButton = document.createElement("button");
searchButton.innerHTML = '<span class="ENG">Submit</span>';
const usernameInput = document.createElement("input");
usernameInput.id = "MemberListCredit_txtSearch";
usernameInput.value = "BFJ@Nia303";
const amountInput = document.createElement("input");
amountInput.id = "ctl03_txtCreditNum";
const bankSelect = document.createElement("select");
bankSelect.id = "ctl03_lstBankTo";
const bankOption = document.createElement("option");
bankOption.value = "SCB|41466";
bankOption.textContent = "SCB - SCB A BONUS DEPOSIT HARIAN 01";
bankSelect.appendChild(bankOption);
const remarkInput = document.createElement("input");
remarkInput.id = "ctl03_txtRemark";
remarkInput.value = "must be cleared";
const finalButton = document.createElement("button");
finalButton.innerHTML = '<span class="ENG">Submit</span>';
let submitted = 0;
finalButton.addEventListener("click", () => { submitted += 1; });
document.body.append(searchButton, usernameInput, amountInput, bankSelect, remarkInput, finalButton);

await new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "../bot/deposit-assistant.js";
  script.onload = resolve;
  script.onerror = () => reject(new Error("deposit assistant script failed to load"));
  document.head.appendChild(script);
});
for (let attempt = 0; attempt < 20 && amountInput.value !== "30000"; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
check(amountInput.value === "30000", "bot fills exact bonus amount");
check(bankSelect.value === "SCB|41466", "bot keeps required To Bank");
check(remarkInput.value === "", "bot clears remark");
check(document.querySelector("#bns-bot-assistant-banner")?.textContent.includes("BOT READY"), "bot ready banner");
finalButton.click();
for (let attempt = 0; attempt < 20 && !submitted; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
check(botMessages.includes("BNS_BOT_FINAL_SUBMIT"), "admin final submit is reported to controller");
check(submitted === 1, "final submit proceeds once after admin click");

document.body.dataset.status = failures.length ? "fail" : "pass";
output.textContent = failures.length ? `FAIL\n${failures.join("\n")}` : "PASS: core + scanner + deposit bot + bonus audit browser smoke tests";
