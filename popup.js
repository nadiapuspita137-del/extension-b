import { normalizeExtractedRows, normalizeUsername } from "./core/normalize.js";
import { STATUS, validateSnapshots } from "./core/validator.js";
import { sortTransactions } from "./core/sort.js";
import { configuredPageType, PANEL_TAB_PATTERN, PANEL_TYPES, PANEL_URLS } from "./core/panels.js";
import {
  clearAllData,
  loadState,
  saveSnapshot,
  saveStopBns,
  saveValidation
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
  clearStopBnsButton: document.querySelector("#clear-stop-bns-button")
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
      count.textContent = `${numberFormatter.format(snapshot.rows.length)} rows`;
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

function render() {
  renderSnapshots();
  renderStopBns();
  renderValidation();
}

async function refreshState() {
  state = await loadState();
  render();
}

function createSnapshot(response) {
  const normalized = normalizeExtractedRows(response.rows);
  return {
    rows: normalized.rows,
    capturedAt: new Date().toISOString(),
    rawRowCount: response.sourceRowCount ?? response.rows.length,
    invalidAmounts: normalized.invalidAmounts,
    skippedWithoutUsername: response.skippedWithoutUsername ?? 0,
    source: response.source
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

async function scanPanelTab(tab, expectedType) {
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
          return response;
        }
        lastMessage = response?.message || "Scan failed.";
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

  const validation = validateSnapshots(
    state.dp.rows,
    state.wd.rows,
    state.scb.rows,
    state.stopBns?.ids ?? []
  );
  validation.stats.rawDp = state.dp.rawRowCount ?? state.dp.rows.length;
  validation.stats.invalidAmounts = state.dp.invalidAmounts ?? validation.stats.invalidAmounts;
  validation.runAt = new Date().toISOString();
  validation.sourceCapturedAt = {
    dp: state.dp.capturedAt,
    wd: state.wd.capturedAt,
    scb: state.scb.capturedAt
  };

  await saveValidation(validation);
  await refreshState();
  return validation;
}

async function runValidation() {
  setBusy(elements.validateButton, true, "Validating…");
  try {
    const validation = await calculateAndSaveValidation();
    setNotice(
      `Validation selesai: ${validation.stats.bns} BNS, ${validation.stats.stopBns} Stop BNS, dari ${validation.stats.eligible} transaksi eligible.`,
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
    setNotice("Menunggu tabel lalu memindai DP, WD, dan SCB sekaligus…");
    const responses = await Promise.all(
      PANEL_TYPES.map(async (type) => [type, await scanPanelTab(tabs[type], type)])
    );

    for (const [type, response] of responses) {
      await saveSnapshot(type, createSnapshot(response));
    }
    await refreshState();
    const validation = await calculateAndSaveValidation();
    const rowSummary = PANEL_TYPES
      .map((type) => `${type} ${state[type.toLocaleLowerCase("en-US")].rows.length}`)
      .join(" · ");
    setNotice(
      `${rowSummary}. Validation: ${validation.stats.bns} BNS, ${validation.stats.stopBns} Stop BNS.`,
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
      (row) => `${row.username} | ${numberFormatter.format(row.amount)} | ${row.datetime}`
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

refreshState().catch((error) => setNotice(error.message, "error"));
