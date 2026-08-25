import {
  isDailyBonusToBank,
  isManualDepositToBank,
  normalizeExtractedRows,
  normalizeUsername
} from "./core/normalize.js";
import { STATUS, validateSnapshots } from "./core/validator.js";
import { sortTransactions } from "./core/sort.js";
import { configuredPageType, PANEL_TAB_PATTERN, PANEL_TYPES, PANEL_URLS } from "./core/panels.js";
import { BONUS_STATUS, buildBonusQueue } from "./core/bonus.js";
import { AUDIT_ISSUE, AUDIT_STATUS, auditBonusPayments } from "./core/audit.js";
import { mergePageResponses } from "./core/pagination.js";
import {
  clearAllData,
  loadState,
  saveDerivedResults,
  saveSnapshot,
  saveStopBns
} from "./core/storage.js";

const SCAN_TIMEOUT_MS = 25_000;
const RETRY_INTERVAL_MS = 700;

const elements = {
  notice: document.querySelector("#notice"),
  scanAllButton: document.querySelector("#scan-all-button"),
  scanButton: document.querySelector("#scan-button"),
  validateButton: document.querySelector("#validate-button"),
  viewBnsButton: document.querySelector("#view-bns-button"),
  clearButton: document.querySelector("#clear-button"),
  statusFilter: document.querySelector("#status-filter"),
  resultSort: document.querySelector("#result-sort"),
  usernameSearch: document.querySelector("#username-search"),
  resultsBody: document.querySelector("#results-body"),
  emptyResults: document.querySelector("#empty-results"),
  visibleCount: document.querySelector("#visible-count"),
  validationTime: document.querySelector("#validation-time"),
  invalidSummary: document.querySelector("#invalid-summary"),
  copyUsernamesButton: document.querySelector("#copy-usernames-button"),
  copyDetailsButton: document.querySelector("#copy-details-button"),
  resultsSection: document.querySelector("#results-section"),
  stopBnsInput: document.querySelector("#stop-bns-input"),
  stopBnsCount: document.querySelector("#stop-bns-count"),
  stopBnsTime: document.querySelector("#stop-bns-time"),
  saveStopBnsButton: document.querySelector("#save-stop-bns-button"),
  clearStopBnsButton: document.querySelector("#clear-stop-bns-button"),
  bonusGeneratedTime: document.querySelector("#bonus-generated-time"),
  bonusFilter: document.querySelector("#bonus-filter"),
  bonusSort: document.querySelector("#bonus-sort"),
  bonusResultsBody: document.querySelector("#bonus-results-body"),
  emptyBonusResults: document.querySelector("#empty-bonus-results"),
  nextBonusUsername: document.querySelector("#next-bonus-username"),
  nextBonusDp: document.querySelector("#next-bonus-dp"),
  nextBonusAmount: document.querySelector("#next-bonus-amount"),
  copyNextIdButton: document.querySelector("#copy-next-id-button"),
  copyNextBonusButton: document.querySelector("#copy-next-bonus-button"),
  copyReadyQueueButton: document.querySelector("#copy-ready-queue-button"),
  botStartButton: document.querySelector("#bot-start-button"),
  botStopButton: document.querySelector("#bot-stop-button"),
  botStatusBadge: document.querySelector("#bot-status-badge"),
  botCurrentId: document.querySelector("#bot-current-id"),
  botCurrentAmount: document.querySelector("#bot-current-amount"),
  botCompletedCount: document.querySelector("#bot-completed-count"),
  botStage: document.querySelector("#bot-stage"),
  paymentAuditTime: document.querySelector("#payment-audit-time"),
  paymentAuditFilter: document.querySelector("#payment-audit-filter"),
  paymentAuditSort: document.querySelector("#payment-audit-sort"),
  paymentAuditBody: document.querySelector("#payment-audit-body"),
  emptyPaymentAudit: document.querySelector("#empty-payment-audit"),
  copyAuditIssuesButton: document.querySelector("#copy-audit-issues-button"),
  auditExpectedTotal: document.querySelector("#audit-expected-total"),
  auditActualTotal: document.querySelector("#audit-actual-total"),
  auditDifference: document.querySelector("#audit-difference")
};

const statElements = {
  rawDp: document.querySelector("#stat-raw"),
  eligible: document.querySelector("#stat-eligible"),
  ignoredBelowMinimum: document.querySelector("#stat-below"),
  ignoredAtOrAboveMaximum: document.querySelector("#stat-above"),
  bns: document.querySelector("#stat-bns"),
  stopBns: document.querySelector("#stat-stop"),
  foundWd: document.querySelector("#stat-wd"),
  foundScb: document.querySelector("#stat-scb"),
  foundWdAndScb: document.querySelector("#stat-both")
};

const bonusStatElements = {
  uniqueDp: document.querySelector("#bonus-stat-unique"),
  inRange: document.querySelector("#bonus-stat-range"),
  ready: document.querySelector("#bonus-stat-ready"),
  alreadyInHistory: document.querySelector("#bonus-stat-history"),
  foundWd: document.querySelector("#bonus-stat-wd"),
  foundWdAndHistory: document.querySelector("#bonus-stat-both"),
  stopBns: document.querySelector("#bonus-stat-stop"),
  outOfRangeBelow: document.querySelector("#bonus-stat-below"),
  outOfRangeAbove: document.querySelector("#bonus-stat-above")
};

const auditStatElements = {
  correct: document.querySelector("#audit-stat-correct"),
  issues: document.querySelector("#audit-stat-issues"),
  missing: document.querySelector("#audit-stat-missing"),
  doubleBonus: document.querySelector("#audit-stat-double"),
  overpaid: document.querySelector("#audit-stat-over"),
  underpaid: document.querySelector("#audit-stat-under"),
  noDp: document.querySelector("#audit-stat-no-dp"),
  ruleViolations: document.querySelector("#audit-stat-rule")
};

const numberFormatter = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
let state = {};
let stopBnsInputDirty = false;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function setNotice(message, kind = "neutral") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${kind}`;
}

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function renderSnapshots() {
  for (const key of ["dp", "wd", "scb"]) {
    const snapshot = state[key];
    const count = document.querySelector(`#${key}-count`);
    const time = document.querySelector(`#${key}-time`);
    if (snapshot) {
      if (key === "dp") {
        count.textContent = `${numberFormatter.format(snapshot.rows.length)} QRIS DP`;
      } else if (key === "scb") {
        count.textContent = `${numberFormatter.format(snapshot.rows.length)} bonus · ${numberFormatter.format(snapshot.manualDepositRows?.length ?? 0)} manual DP`;
      } else {
        count.textContent = `${numberFormatter.format(snapshot.rows.length)} rows`;
      }
      time.textContent = `Updated ${formatTimestamp(snapshot.capturedAt)}`;
    } else {
      count.textContent = "Belum diambil";
      time.textContent = "—";
    }
  }
}

function renderStopBns() {
  const ids = state.stopBns?.ids ?? [];
  elements.stopBnsCount.textContent = `${numberFormatter.format(ids.length)} ID tersimpan`;
  elements.stopBnsTime.textContent = state.stopBns?.updatedAt
    ? `Updated ${formatTimestamp(state.stopBns.updatedAt)}`
    : "Belum disimpan";
  if (!stopBnsInputDirty) {
    elements.stopBnsInput.value = ids.map((item) => item.username).join("\n");
  }
}

function statusLabel(status) {
  return {
    [STATUS.BNS]: "BNS",
    [STATUS.STOP_BNS]: "STOP BNS",
    [STATUS.FOUND_WD]: "FOUND WD",
    [STATUS.FOUND_SCB]: "FOUND SCB",
    [STATUS.FOUND_WD_AND_SCB]: "WD + SCB"
  }[status] || status;
}

function statusClass(status) {
  return {
    [STATUS.BNS]: "status-bns",
    [STATUS.STOP_BNS]: "status-stop",
    [STATUS.FOUND_WD]: "status-wd",
    [STATUS.FOUND_SCB]: "status-scb",
    [STATUS.FOUND_WD_AND_SCB]: "status-both"
  }[status] || "status-both";
}

function filterMatches(result, filter) {
  if (filter === "ALL") return true;
  if (filter === STATUS.FOUND_WD) {
    return result.status === STATUS.FOUND_WD || result.status === STATUS.FOUND_WD_AND_SCB;
  }
  if (filter === STATUS.FOUND_SCB) {
    return result.status === STATUS.FOUND_SCB || result.status === STATUS.FOUND_WD_AND_SCB;
  }
  return result.status === filter;
}

function getVisibleResults() {
  const results = state.validation?.results ?? [];
  const filter = elements.statusFilter.value;
  const search = normalizeUsername(elements.usernameSearch.value);
  const filtered = results.filter(
    (result) => filterMatches(result, filter) && (!search || result.usernameKey.includes(search))
  );
  return sortTransactions(filtered, elements.resultSort.value);
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.appendChild(cell);
  return cell;
}

function renderResults() {
  elements.resultsBody.replaceChildren();
  const visible = getVisibleResults();
  elements.visibleCount.textContent = `${numberFormatter.format(visible.length)} transaksi`;
  elements.emptyResults.hidden = visible.length > 0;
  elements.emptyResults.textContent = state.validation
    ? "Tidak ada hasil untuk filter ini."
    : "Jalankan validasi untuk melihat hasil.";

  for (const result of visible) {
    const row = document.createElement("tr");
    appendCell(row, result.username);
    appendCell(row, numberFormatter.format(result.amount));
    appendCell(row, result.datetime || "—");
    const statusCell = appendCell(row, "");
    const pill = document.createElement("span");
    pill.className = `status-pill ${statusClass(result.status)}`;
    pill.textContent = statusLabel(result.status);
    statusCell.appendChild(pill);
    elements.resultsBody.appendChild(row);
  }
}

function renderValidation() {
  const validation = state.validation;
  for (const [key, element] of Object.entries(statElements)) {
    element.textContent = validation ? numberFormatter.format(validation.stats[key] ?? 0) : "—";
  }

  elements.validationTime.textContent = validation
    ? `Run ${formatTimestamp(validation.runAt)}`
    : "Belum dijalankan";

  const invalid = validation?.stats?.invalidAmounts ?? state.dp?.invalidAmounts ?? 0;
  const skipped = state.dp?.skippedWithoutUsername ?? 0;
  const diagnostics = [];
  if (invalid) diagnostics.push(`${numberFormatter.format(invalid)} invalid amounts ignored`);
  if (skipped) diagnostics.push(`${numberFormatter.format(skipped)} rows tanpa username dilewati`);
  elements.invalidSummary.textContent = diagnostics.join(" · ");
  renderResults();
}

function bonusStatusLabel(status) {
  return {
    [BONUS_STATUS.READY]: "READY",
    [BONUS_STATUS.FOUND_WD]: "FOUND WD",
    [BONUS_STATUS.ALREADY_IN_HISTORY]: "IN HISTORY",
    [BONUS_STATUS.FOUND_WD_AND_HISTORY]: "WD + HISTORY",
    [BONUS_STATUS.STOP_BNS]: "STOP BNS",
    [BONUS_STATUS.OUT_OF_RANGE_BELOW]: "MAX < 50K",
    [BONUS_STATUS.OUT_OF_RANGE_ABOVE]: "MAX ≥ 500K"
  }[status] || status;
}

function bonusStatusClass(status) {
  return {
    [BONUS_STATUS.READY]: "status-ready",
    [BONUS_STATUS.FOUND_WD]: "status-wd",
    [BONUS_STATUS.ALREADY_IN_HISTORY]: "status-history",
    [BONUS_STATUS.FOUND_WD_AND_HISTORY]: "status-both",
    [BONUS_STATUS.STOP_BNS]: "status-stop",
    [BONUS_STATUS.OUT_OF_RANGE_BELOW]: "status-range",
    [BONUS_STATUS.OUT_OF_RANGE_ABOVE]: "status-range"
  }[status] || "status-both";
}

function bonusFilterMatches(row, filter) {
  if (filter === "ALL") return true;
  if (filter === "OUT_OF_RANGE") {
    return row.status === BONUS_STATUS.OUT_OF_RANGE_BELOW || row.status === BONUS_STATUS.OUT_OF_RANGE_ABOVE;
  }
  if (filter === BONUS_STATUS.FOUND_WD) {
    return row.status === BONUS_STATUS.FOUND_WD || row.status === BONUS_STATUS.FOUND_WD_AND_HISTORY;
  }
  if (filter === BONUS_STATUS.ALREADY_IN_HISTORY) {
    return row.status === BONUS_STATUS.ALREADY_IN_HISTORY || row.status === BONUS_STATUS.FOUND_WD_AND_HISTORY;
  }
  return row.status === filter;
}

function getSortedReadyBonusRows() {
  const ready = (state.bonusQueue?.rows ?? []).filter((row) => row.status === BONUS_STATUS.READY);
  return sortTransactions(ready, elements.bonusSort.value);
}

function getVisibleBonusRows() {
  const rows = state.bonusQueue?.rows ?? [];
  const filtered = rows.filter((row) => bonusFilterMatches(row, elements.bonusFilter.value));
  return sortTransactions(filtered, elements.bonusSort.value);
}

function renderBonusQueue() {
  const queue = state.bonusQueue;
  const stats = queue?.stats;

  for (const [key, element] of Object.entries(bonusStatElements)) {
    element.textContent = stats ? numberFormatter.format(stats[key] ?? 0) : "—";
  }
  elements.bonusGeneratedTime.textContent = queue
    ? `Generated ${formatTimestamp(queue.generatedAt)}`
    : "Belum dibuat";

  const readyRows = getSortedReadyBonusRows();
  const next = readyRows[0];
  elements.nextBonusUsername.textContent = next?.username ?? "—";
  elements.nextBonusDp.textContent = next ? numberFormatter.format(next.maximumDp) : "—";
  elements.nextBonusAmount.textContent = next ? numberFormatter.format(next.bonusAmount) : "—";
  elements.copyNextIdButton.disabled = !next;
  elements.copyNextBonusButton.disabled = !next;
  elements.copyReadyQueueButton.disabled = readyRows.length === 0;

  elements.bonusResultsBody.replaceChildren();
  const visible = getVisibleBonusRows();
  elements.emptyBonusResults.hidden = visible.length > 0;
  elements.emptyBonusResults.textContent = queue
    ? "Tidak ada ID untuk filter queue ini."
    : "Scan dan jalankan validation untuk membuat antrean.";

  for (const item of visible) {
    const row = document.createElement("tr");
    appendCell(row, item.username);
    appendCell(row, numberFormatter.format(item.maximumDp));
    appendCell(row, item.bonusAmount === null ? "—" : numberFormatter.format(item.bonusAmount));
    appendCell(row, numberFormatter.format(item.transactionCount));
    const statusCell = appendCell(row, "");
    const pill = document.createElement("span");
    pill.className = `status-pill ${bonusStatusClass(item.status)}`;
    pill.textContent = bonusStatusLabel(item.status);
    statusCell.appendChild(pill);
    elements.bonusResultsBody.appendChild(row);
  }
}

function auditIssueLabel(issue) {
  return {
    [AUDIT_ISSUE.DOUBLE_BONUS]: "DOUBLE",
    [AUDIT_ISSUE.OVERPAID]: "NOMINAL LEBIH",
    [AUDIT_ISSUE.UNDERPAID]: "NOMINAL KURANG",
    [AUDIT_ISSUE.NO_DP]: "TANPA DP",
    [AUDIT_ISSUE.OUT_OF_RANGE_BELOW]: "MAX < 50K",
    [AUDIT_ISSUE.OUT_OF_RANGE_ABOVE]: "MAX ≥ 500K",
    [AUDIT_ISSUE.FOUND_WD]: "ADA WD",
    [AUDIT_ISSUE.STOP_BNS]: "STOP BNS",
    [AUDIT_ISSUE.MISSING_BONUS]: "BELUM DIBAGI"
  }[issue] || issue;
}

function auditFilterMatches(row, filter) {
  if (filter === "ALL") return true;
  if (filter === "PROBLEM") return row.status !== AUDIT_STATUS.CORRECT;
  if (filter === "CORRECT") return row.status === AUDIT_STATUS.CORRECT;
  if (filter === "MISSING") return row.status === AUDIT_STATUS.MISSING;
  if (filter === "INVALID_RULE") {
    return row.issues.some((issue) => [
      AUDIT_ISSUE.NO_DP,
      AUDIT_ISSUE.OUT_OF_RANGE_BELOW,
      AUDIT_ISSUE.OUT_OF_RANGE_ABOVE,
      AUDIT_ISSUE.FOUND_WD,
      AUDIT_ISSUE.STOP_BNS
    ].includes(issue));
  }
  return row.issues.includes(filter);
}

function getVisibleAuditRows() {
  const rows = state.bonusAudit?.rows ?? [];
  return sortTransactions(
    rows.filter((row) => auditFilterMatches(row, elements.paymentAuditFilter.value)),
    elements.paymentAuditSort.value
  );
}

function renderPaymentAudit() {
  const audit = state.bonusAudit;
  const stats = audit?.stats;
  auditStatElements.correct.textContent = stats ? numberFormatter.format(stats.correct) : "—";
  auditStatElements.issues.textContent = stats ? numberFormatter.format(stats.issueRows + stats.missing) : "—";
  auditStatElements.missing.textContent = stats ? numberFormatter.format(stats.missing) : "—";
  auditStatElements.doubleBonus.textContent = stats ? numberFormatter.format(stats.doubleBonus) : "—";
  auditStatElements.overpaid.textContent = stats ? numberFormatter.format(stats.overpaid) : "—";
  auditStatElements.underpaid.textContent = stats ? numberFormatter.format(stats.underpaid) : "—";
  auditStatElements.noDp.textContent = stats ? numberFormatter.format(stats.noDp) : "—";
  auditStatElements.ruleViolations.textContent = stats ? numberFormatter.format(stats.ruleViolations) : "—";
  elements.paymentAuditTime.textContent = audit ? `Generated ${formatTimestamp(audit.generatedAt)}` : "Belum dibuat";
  elements.auditExpectedTotal.textContent = stats ? numberFormatter.format(stats.expectedTotal) : "—";
  elements.auditActualTotal.textContent = stats ? numberFormatter.format(stats.actualTotal) : "—";
  elements.auditDifference.textContent = stats
    ? `${stats.difference > 0 ? "+" : ""}${numberFormatter.format(stats.difference)}`
    : "—";
  elements.auditDifference.style.color = !stats || stats.difference === 0
    ? ""
    : stats.difference > 0 ? "#a53939" : "#7754a3";

  const rows = getVisibleAuditRows();
  elements.paymentAuditBody.replaceChildren();
  elements.emptyPaymentAudit.hidden = rows.length > 0;
  elements.emptyPaymentAudit.textContent = audit
    ? "Tidak ada data untuk filter audit ini."
    : "Scan dan jalankan validation untuk membuat audit.";
  elements.copyAuditIssuesButton.disabled = !(audit?.rows ?? []).some((row) => row.status !== AUDIT_STATUS.CORRECT);

  for (const item of rows) {
    const row = document.createElement("tr");
    appendCell(row, item.username);
    appendCell(row, item.maximumDp === null ? "—" : numberFormatter.format(item.maximumDp));
    appendCell(row, item.expectedBonus === null ? "—" : numberFormatter.format(item.expectedBonus));
    appendCell(row, numberFormatter.format(item.actualTotal));
    appendCell(row, numberFormatter.format(item.actualTransactionCount));
    const issueCell = appendCell(row, "");
    const findings = item.status === AUDIT_STATUS.CORRECT ? ["BENAR"] : item.issues.map(auditIssueLabel);
    for (const finding of findings) {
      const pill = document.createElement("span");
      pill.className = `status-pill ${item.status === AUDIT_STATUS.CORRECT ? "status-ready" : item.status === AUDIT_STATUS.MISSING ? "status-stop" : "status-bns"}`;
      pill.textContent = finding;
      pill.style.margin = "0 3px 3px 0";
      issueCell.appendChild(pill);
    }
    elements.paymentAuditBody.appendChild(row);
  }
}

function botStageLabel(botState) {
  const labels = {
    STARTING: "Menyiapkan bot…",
    NAVIGATING: "Membuka form Deposit Manual…",
    BANK_POSTBACK: "To Bank dipilih; menunggu panel memuat ulang…",
    READY_TO_SUBMIT: "Form sudah terisi. Cek lalu klik final Submit pada panel.",
    SUBMIT_CLICKED: "Submit diklik admin; menunggu panel selesai lalu membuka ID berikutnya…",
    ADVANCING: "Membuka ID berikutnya tanpa verifikasi otomatis…",
    NEXT: "Membuka ID berikutnya…",
    FORM_ERROR: "Form tidak dapat disiapkan.",
    VERIFY_FAILED: "State versi lama. Klik BOT ON untuk melewati ID yang sudah disubmit.",
    COMPLETE: "Semua ID READY selesai diproses. Jalankan Scan/Validate manual.",
    STOPPED: "Bot dihentikan admin."
  };
  return labels[botState?.stage] || "Bot belum dijalankan.";
}

function renderBotState() {
  const bot = state.botState;
  const active = Boolean(bot?.active);
  const hasError = Boolean(bot?.error) || ["FORM_ERROR", "VERIFY_FAILED"].includes(bot?.stage);
  elements.botStatusBadge.textContent = active ? "ON" : hasError ? "ERROR" : "OFF";
  elements.botStatusBadge.className = `bot-status-badge ${active ? "on" : hasError ? "error" : "off"}`;
  elements.botCurrentId.textContent = bot?.current?.username ?? "—";
  elements.botCurrentAmount.textContent = Number.isFinite(bot?.current?.bonusAmount)
    ? numberFormatter.format(bot.current.bonusAmount)
    : "—";
  elements.botCompletedCount.textContent = numberFormatter.format(bot?.completedCount ?? 0);
  elements.botStage.textContent = bot?.error || botStageLabel(bot);
  elements.botStartButton.disabled = active || !state.bonusQueue?.stats?.ready;
  elements.botStopButton.disabled = !active;

  for (const button of [
    elements.scanAllButton,
    elements.scanButton,
    elements.validateButton,
    elements.saveStopBnsButton,
    elements.clearStopBnsButton,
    elements.clearButton
  ]) {
    button.disabled = active;
  }
}

function render() {
  renderSnapshots();
  renderStopBns();
  renderValidation();
  renderBonusQueue();
  renderPaymentAudit();
  renderBotState();
}

async function refreshState() {
  state = await loadState();
  render();
}

function createSnapshot(response) {
  const isScb = response.pageType === "SCB";
  if (isScb && !(response.source?.columns?.toBank >= 0)) {
    throw new Error("SCB gagal difilter: kolom To Bank tidak ditemukan pada tabel.");
  }
  const sourceRows = response.rows ?? [];
  const selectedRows = isScb
    ? sourceRows.filter((row) => isDailyBonusToBank(row.toBank))
    : sourceRows;
  const manualDepositSourceRows = isScb
    ? sourceRows.filter((row) => isManualDepositToBank(row.toBank))
    : [];
  const normalized = normalizeExtractedRows(selectedRows);
  const normalizedManualDeposits = normalizeExtractedRows(manualDepositSourceRows);
  const scannedEveryPage =
    response.pagination?.pagesScanned &&
    response.pagination.pagesScanned === response.pagination.totalPages;
  return {
    rows: normalized.rows,
    ...(isScb ? {
      manualDepositRows: normalizedManualDeposits.rows,
      manualDepositInvalidAmounts: normalizedManualDeposits.invalidAmounts
    } : {}),
    capturedAt: new Date().toISOString(),
    rawRowCount: isScb
      ? normalized.rows.length
      : scannedEveryPage && response.pagination.totalRecords
      ? response.pagination.totalRecords
      : response.sourceRowCount ?? response.rows.length,
    invalidAmounts: normalized.invalidAmounts,
    skippedWithoutUsername: response.skippedWithoutUsername ?? 0,
    source: {
      ...response.source,
      ...(isScb ? {
        filter: "To Bank contains SCB A BONUS DEPOSIT HARIAN 01",
        rowsBeforeFilter: sourceRows.length,
        filteredOut: sourceRows.length - selectedRows.length,
        manualDepositRows: normalizedManualDeposits.rows.length,
        excludedInternalScbRows: sourceRows.length - selectedRows.length - manualDepositSourceRows.length
      } : {})
    }
  };
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error("Active tab not found.");
  return tab;
}

async function requestPageScan(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/scanner.js"]
  });
  return chrome.tabs.sendMessage(tabId, { type: "BNS_SCAN_CURRENT_PAGE" });
}

async function findOrOpenPanelTabs() {
  const openTabs = await chrome.tabs.query({ url: PANEL_TAB_PATTERN });
  const tabByType = {};

  for (const tab of openTabs) {
    const type = configuredPageType(tab.url);
    if (type && !tabByType[type]) tabByType[type] = tab;
  }

  for (const type of PANEL_TYPES) {
    if (!tabByType[type]) {
      tabByType[type] = await chrome.tabs.create({ url: PANEL_URLS[type], active: false });
    }
  }
  return tabByType;
}

async function scanPanelTab(tab, expectedType, expectedPage = 1) {
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  let lastMessage = "Table not ready.";

  while (Date.now() < deadline) {
    try {
      const currentTab = await chrome.tabs.get(tab.id);
      if (currentTab.status === "complete") {
        const response = await requestPageScan(tab.id);
        if (response?.ok) {
          if (response.pageType !== expectedType) {
            throw new Error(`terdeteksi sebagai ${response.pageType}`);
          }
          const currentPage = response.pagination?.currentPage ?? 1;
          if (currentPage === expectedPage) return response;
          lastMessage = `menunggu page ${expectedPage}, sekarang masih page ${currentPage}`;
        } else {
          lastMessage = response?.message || "Scan failed.";
        }
      } else {
        lastMessage = "halaman masih loading";
      }
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "Scan failed.";
    }
    await delay(RETRY_INTERVAL_MS);
  }

  throw new Error(`${expectedType} gagal dipindai: ${lastMessage} Pastikan login dan tabel sudah tampil.`);
}

async function goToNextPanelPage(tabId, pageNumber) {
  const execution = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (targetPage) => {
      const nextButton = document.querySelector('button[id$="_btnNext"]');
      if (nextButton && !nextButton.disabled) {
        setTimeout(() => nextButton.click(), 30);
        return { ok: true, method: "next" };
      }

      const input = document.querySelector('input[id$="_txtPgNum"]');
      if (!input) return { ok: false, message: "Tombol Next dan input pagination tidak ditemukan." };
      const buttonId = input.id.replace(/_txtPgNum$/, "_btnPgNum");
      const button = document.getElementById(buttonId);
      if (!button) return { ok: false, message: "Tombol submit pagination tidak ditemukan." };
      input.value = String(targetPage);
      input.setAttribute("value", String(targetPage));
      setTimeout(() => button.click(), 30);
      return { ok: true, method: "page-number" };
    },
    args: [pageNumber]
  });
  const result = execution[0]?.result;
  if (!result?.ok) throw new Error(result?.message || `Tidak dapat membuka page ${pageNumber}.`);
}

async function scanPanelAllPages(tab, expectedType) {
  const firstPage = await scanPanelTab(tab, expectedType, 1);
  const totalPages = firstPage.pagination?.totalPages ?? 1;
  if (totalPages < 1 || totalPages > 100) {
    throw new Error(`${expectedType}: jumlah page tidak wajar (${totalPages}).`);
  }
  if (totalPages === 1) return mergePageResponses([firstPage]);

  const pages = [firstPage];
  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
    setNotice(`${expectedType}: memindai page ${pageNumber} dari ${totalPages}…`);
    await goToNextPanelPage(tab.id, pageNumber);
    pages.push(await scanPanelTab(tab, expectedType, pageNumber));
  }
  return mergePageResponses(pages);
}

async function scanCurrentPage() {
  setBusy(elements.scanButton, true, "Scanning…");
  setNotice("Membaca tabel pada halaman aktif…");

  try {
    const tab = await getActiveTab();
    const response = await requestPageScan(tab.id);
    if (!response?.ok) throw new Error(response?.message || "Scan failed.");

    const snapshot = createSnapshot(response);
    await saveSnapshot(response.pageType, snapshot);
    await refreshState();
    const warnings = [];
    if (response.empty) warnings.push("No transaction rows found.");
    if (snapshot.invalidAmounts) warnings.push(`${snapshot.invalidAmounts} nominal invalid dilewati.`);
    if (response.pageType === "SCB" && snapshot.manualDepositRows?.length) {
      warnings.push(`${snapshot.manualDepositRows.length} deposit manual ikut menjadi sumber DP.`);
    }
    if (response.pageType === "SCB" && snapshot.source?.excludedInternalScbRows) {
      warnings.push(`${snapshot.source.excludedInternalScbRows} row SCB bonus lain diabaikan.`);
    }
    setNotice(
      `${response.pageType} saved: ${snapshot.rows.length} rows.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
      "success"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed.";
    const restricted = /cannot access|extensions gallery|chrome:\/\//i.test(message);
    setNotice(
      restricted ? "Halaman ini tidak dapat dipindai. Buka halaman panel lalu coba lagi." : message,
      "error"
    );
  } finally {
    setBusy(elements.scanButton, false);
  }
}

async function calculateAndSaveValidation() {
  const missing = ["dp", "wd", "scb"].filter((key) => !state[key]);
  if (missing.length) {
    throw new Error(`${missing.map((key) => key.toUpperCase()).join(", ")} snapshot missing.`);
  }

  const combinedDepositRows = [
    ...state.dp.rows,
    ...(state.scb.manualDepositRows ?? [])
  ];
  const validation = validateSnapshots(
    combinedDepositRows,
    state.wd.rows,
    state.scb.rows,
    state.stopBns?.ids ?? []
  );
  validation.stats.rawDp = (state.dp.rawRowCount ?? state.dp.rows.length) + (state.scb.manualDepositRows?.length ?? 0);
  validation.stats.invalidAmounts =
    (state.dp.invalidAmounts ?? 0) + (state.scb.manualDepositInvalidAmounts ?? 0);
  validation.runAt = new Date().toISOString();
  validation.sourceCapturedAt = {
    dp: state.dp.capturedAt,
    wd: state.wd.capturedAt,
    scb: state.scb.capturedAt
  };

  const bonusQueue = buildBonusQueue(
    combinedDepositRows,
    state.wd.rows,
    state.scb.rows,
    state.stopBns?.ids ?? []
  );
  bonusQueue.generatedAt = new Date().toISOString();
  bonusQueue.sourceCapturedAt = { ...validation.sourceCapturedAt };

  const bonusAudit = auditBonusPayments(
    combinedDepositRows,
    state.wd.rows,
    state.scb.rows,
    state.stopBns?.ids ?? []
  );
  bonusAudit.generatedAt = new Date().toISOString();
  bonusAudit.sourceCapturedAt = { ...validation.sourceCapturedAt };

  await saveDerivedResults(validation, bonusQueue, bonusAudit);
  await refreshState();
  return validation;
}

async function runValidation() {
  setBusy(elements.validateButton, true, "Validating…");
  try {
    const validation = await calculateAndSaveValidation();
    setNotice(
      `Validation selesai: ${validation.stats.bns} transaksi BNS · ${state.bonusQueue.stats.ready} ID bonus ready · ${state.bonusAudit.stats.issueRows} salah/double · ${state.bonusAudit.stats.missing} belum dibagi.`,
      "success"
    );
    return validation;
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Validation failed.", "error");
    return null;
  } finally {
    setBusy(elements.validateButton, false);
  }
}

async function scanAllPages() {
  setBusy(elements.scanAllButton, true, "Opening & scanning…");
  elements.scanButton.disabled = true;
  elements.validateButton.disabled = true;
  setNotice("Menyiapkan tab DP, WD, dan SCB…");

  try {
    const tabs = await findOrOpenPanelTabs();
    setNotice("Memuat ulang halaman history DP, WD, dan SCB secara aman…");
    await Promise.all(
      PANEL_TYPES.map((type) => chrome.tabs.update(tabs[type].id, { url: PANEL_URLS[type] }))
    );
    const responses = await Promise.all(
      PANEL_TYPES.map(async (type) => [type, await scanPanelAllPages(tabs[type], type)])
    );

    for (const [type, response] of responses) {
      await saveSnapshot(type, createSnapshot(response));
    }
    await refreshState();
    const validation = await calculateAndSaveValidation();
    const rowSummary = PANEL_TYPES
      .map((type) => {
        const snapshot = state[type.toLocaleLowerCase("en-US")];
        const pageCount = snapshot.source?.pagesScanned ?? 1;
        const filterInfo = type === "SCB"
          ? `, ${snapshot.manualDepositRows?.length ?? 0} manual DP${snapshot.source?.excludedInternalScbRows ? `, ${snapshot.source.excludedInternalScbRows} SCB lain diabaikan` : ""}`
          : "";
        return `${type} ${snapshot.rows.length}${pageCount > 1 ? ` (${pageCount} pages)` : ""}${filterInfo}`;
      })
      .join(" · ");
    setNotice(
      `${rowSummary}. ${validation.stats.bns} transaksi BNS · ${state.bonusQueue.stats.ready} ID ready · ${state.bonusAudit.stats.issueRows} salah/double · ${state.bonusAudit.stats.missing} belum dibagi.`,
      "success"
    );
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Scan All failed.", "error");
  } finally {
    setBusy(elements.scanAllButton, false);
    elements.scanButton.disabled = false;
    elements.validateButton.disabled = false;
  }
}

function parseStopBnsInput(value) {
  const unique = new Map();
  for (const rawValue of String(value ?? "").split(/[\r\n,\t]+/)) {
    const username = rawValue.trim();
    const usernameKey = normalizeUsername(username);
    if (usernameKey && !unique.has(usernameKey)) unique.set(usernameKey, { username, usernameKey });
  }
  return [...unique.values()];
}

async function persistStopBns(ids) {
  const stopBns = { ids, updatedAt: new Date().toISOString() };
  await saveStopBns(stopBns);
  stopBnsInputDirty = false;
  await refreshState();

  let validationUpdated = false;
  if (state.dp && state.wd && state.scb) {
    await calculateAndSaveValidation();
    validationUpdated = true;
  }
  return { stopBns, validationUpdated };
}

async function saveStopBnsList() {
  setBusy(elements.saveStopBnsButton, true, "Saving…");
  try {
    const ids = parseStopBnsInput(elements.stopBnsInput.value);
    const saved = await persistStopBns(ids);
    setNotice(
      `${ids.length} ID Stop BNS tersimpan.${saved.validationUpdated ? " Hasil validation sudah diperbarui." : ""}`,
      "success"
    );
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Stop BNS gagal disimpan.", "error");
  } finally {
    setBusy(elements.saveStopBnsButton, false);
  }
}

async function clearStopBnsList() {
  setBusy(elements.clearStopBnsButton, true, "Clearing…");
  try {
    elements.stopBnsInput.value = "";
    await persistStopBns([]);
    setNotice("Daftar Stop BNS sudah dikosongkan.", "success");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Stop BNS gagal dihapus.", "error");
  } finally {
    setBusy(elements.clearStopBnsButton, false);
  }
}

async function copyBonusValue(value, successMessage) {
  if (!value) {
    setNotice("Tidak ada ID bonus READY untuk dicopy.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(String(value));
    setNotice(successMessage, "success");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Copy failed.", "error");
  }
}

async function copyNextBonusId() {
  const next = getSortedReadyBonusRows()[0];
  await copyBonusValue(next?.username, next ? `ID ${next.username} berhasil dicopy.` : "");
}

async function copyNextBonusAmount() {
  const next = getSortedReadyBonusRows()[0];
  await copyBonusValue(next?.bonusAmount, next ? `Bonus ${numberFormatter.format(next.bonusAmount)} berhasil dicopy.` : "");
}

async function copyReadyBonusQueue() {
  const rows = getSortedReadyBonusRows();
  const text = rows.map((row) => `${row.username}\t${row.bonusAmount}`).join("\n");
  await copyBonusValue(text, `${rows.length} ID READY berhasil dicopy dalam 2 kolom Sheet.`);
}

async function copyAuditIssues() {
  const rows = (state.bonusAudit?.rows ?? []).filter((row) => row.status !== AUDIT_STATUS.CORRECT);
  const lines = sortTransactions(rows, elements.paymentAuditSort.value).map((row) => {
    const maximumDp = row.maximumDp === null ? "TANPA DP" : row.maximumDp;
    const expected = row.expectedBonus === null ? "TIDAK BERHAK" : row.expectedBonus;
    const findings = row.issues.map(auditIssueLabel).join(", ");
    return `${row.username}\t${maximumDp}\t${expected}\t${row.actualTotal}\t${row.actualTransactionCount}\t${findings}`;
  });
  await copyBonusValue(lines.join("\n"), `${rows.length} temuan Bonus Audit berhasil dicopy ke kolom Sheet.`);
}

function getBnsResults() {
  return (state.validation?.results ?? []).filter((result) => result.status === STATUS.BNS);
}

async function copyText(text) {
  if (!text) {
    setNotice("Tidak ada hasil BNS untuk dicopy.", "error");
    return;
  }
  await navigator.clipboard.writeText(text);
  setNotice("Hasil BNS berhasil dicopy.", "success");
}

async function copyBnsUsernames() {
  try {
    const sortedBns = sortTransactions(getBnsResults(), elements.resultSort.value);
    const uniqueUsernames = [...new Map(sortedBns.map((row) => [row.usernameKey, row.username])).values()];
    await copyText(uniqueUsernames.join("\n"));
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Copy failed.", "error");
  }
}

async function copyBnsDetails() {
  try {
    const lines = sortTransactions(getBnsResults(), elements.resultSort.value).map(
      (row) => `${row.username}\t${row.amount}\t${row.datetime}`
    );
    await copyText(lines.join("\n"));
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Copy failed.", "error");
  }
}

function viewBns() {
  if (!state.validation) {
    setNotice("Jalankan validation terlebih dahulu.", "error");
    return;
  }
  elements.statusFilter.value = STATUS.BNS;
  elements.usernameSearch.value = "";
  renderResults();
  elements.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function clearSnapshots() {
  if (!window.confirm("Hapus snapshot DP, WD, SCB, dan hasil validation? Daftar Stop BNS tetap disimpan.")) return;
  try {
    await clearAllData();
    await refreshState();
    setNotice("Semua snapshot dan hasil validation dihapus. Daftar Stop BNS tetap tersimpan.", "success");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Clear failed.", "error");
  }
}

async function startBonusBot() {
  setBusy(elements.botStartButton, true, "STARTING…");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "BNS_BOT_START",
      sortMode: elements.bonusSort.value
    });
    if (!response?.ok) throw new Error(response?.message || "Bot gagal dijalankan.");
    await refreshState();
    setNotice("Bot aktif. Form Deposit Manual sedang dibuka.", "success");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Bot gagal dijalankan.", "error");
  } finally {
    setBusy(elements.botStartButton, false);
    renderBotState();
  }
}

async function stopBonusBot() {
  setBusy(elements.botStopButton, true, "STOPPING…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "BNS_BOT_STOP" });
    if (!response?.ok) throw new Error(response?.message || "Bot gagal dihentikan.");
    await refreshState();
    setNotice("Bot dihentikan. Form yang sudah terbuka tidak akan diproses lanjut.", "success");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Bot gagal dihentikan.", "error");
  } finally {
    setBusy(elements.botStopButton, false);
    renderBotState();
  }
}

elements.scanAllButton.addEventListener("click", scanAllPages);
elements.scanButton.addEventListener("click", scanCurrentPage);
elements.validateButton.addEventListener("click", runValidation);
elements.viewBnsButton.addEventListener("click", viewBns);
elements.copyUsernamesButton.addEventListener("click", copyBnsUsernames);
elements.copyDetailsButton.addEventListener("click", copyBnsDetails);
elements.clearButton.addEventListener("click", clearSnapshots);
elements.saveStopBnsButton.addEventListener("click", saveStopBnsList);
elements.clearStopBnsButton.addEventListener("click", clearStopBnsList);
elements.statusFilter.addEventListener("change", renderResults);
elements.resultSort.addEventListener("change", renderResults);
elements.usernameSearch.addEventListener("input", renderResults);
elements.stopBnsInput.addEventListener("input", () => { stopBnsInputDirty = true; });
elements.bonusFilter.addEventListener("change", renderBonusQueue);
elements.bonusSort.addEventListener("change", renderBonusQueue);
elements.copyNextIdButton.addEventListener("click", copyNextBonusId);
elements.copyNextBonusButton.addEventListener("click", copyNextBonusAmount);
elements.copyReadyQueueButton.addEventListener("click", copyReadyBonusQueue);
elements.botStartButton.addEventListener("click", startBonusBot);
elements.botStopButton.addEventListener("click", stopBonusBot);
elements.paymentAuditFilter.addEventListener("change", renderPaymentAudit);
elements.paymentAuditSort.addEventListener("change", renderPaymentAudit);
elements.copyAuditIssuesButton.addEventListener("click", copyAuditIssues);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.botState || changes.bonusQueue || changes.bonusAudit || changes.scb)) {
    refreshState().catch((error) => setNotice(error.message, "error"));
  }
});

refreshState().catch((error) => setNotice(error.message, "error"));
