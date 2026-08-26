import { configuredPageType, PANEL_TAB_PATTERN, PANEL_TYPES, PANEL_URLS } from "./panels.js";
import { mergePageResponses } from "./pagination.js";

const SCAN_TIMEOUT_MS = 25_000;
const RETRY_INTERVAL_MS = 700;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error("Active tab not found.");
  return tab;
}

export async function requestPageScan(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/scanner.js"]
  });
  return chrome.tabs.sendMessage(tabId, { type: "BNS_SCAN_CURRENT_PAGE" });
}

export async function findOrOpenPanelTabs() {
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

  throw new Error(
    `${expectedType} gagal dipindai: ${lastMessage} Pastikan login dan tabel sudah tampil.`
  );
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
      if (!input) {
        return { ok: false, message: "Tombol Next dan input pagination tidak ditemukan." };
      }
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

export async function scanPanelAllPages(tab, expectedType, onProgress = () => {}) {
  const firstPage = await scanPanelTab(tab, expectedType, 1);
  const totalPages = firstPage.pagination?.totalPages ?? 1;
  if (totalPages < 1 || totalPages > 100) {
    throw new Error(`${expectedType}: jumlah page tidak wajar (${totalPages}).`);
  }
  if (totalPages === 1) return mergePageResponses([firstPage]);

  const pages = [firstPage];
  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
    onProgress(`${expectedType}: memindai page ${pageNumber} dari ${totalPages}…`);
    await goToNextPanelPage(tab.id, pageNumber);
    pages.push(await scanPanelTab(tab, expectedType, pageNumber));
  }
  return mergePageResponses(pages);
}

export async function scanAllConfiguredPanels(onProgress = () => {}) {
  const tabs = await findOrOpenPanelTabs();
  onProgress("Memuat ulang halaman history DP, WD, dan SCB secara aman…");
  await Promise.all(
    PANEL_TYPES.map((type) => chrome.tabs.update(tabs[type].id, { url: PANEL_URLS[type] }))
  );
  return Promise.all(
    PANEL_TYPES.map(async (type) => [
      type,
      await scanPanelAllPages(tabs[type], type, onProgress)
    ])
  );
}
