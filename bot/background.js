import { BONUS_STATUS } from "../core/bonus.js";
import { sortTransactions } from "../core/sort.js";

const DEPOSIT_URL = "https://bfj.porta-assist.com/_SubAg_Sub/AddCreditRequest2.aspx";
let advanceRunning = false;

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(value) {
  return chrome.storage.local.set(value);
}

function publicCurrent(row) {
  return row ? {
    username: row.username,
    usernameKey: row.usernameKey,
    maximumDp: row.maximumDp,
    bonusAmount: row.bonusAmount,
    transactionCount: row.transactionCount
  } : null;
}

async function updateBotState(patch) {
  const { botState = {} } = await storageGet("botState");
  const next = { ...botState, ...patch, updatedAt: new Date().toISOString() };
  await storageSet({ botState: next });
  return next;
}

function readyRows(queue, sortMode, processedKeys = []) {
  const processed = new Set(processedKeys);
  return sortTransactions(
    (queue?.rows ?? []).filter(
      (row) => row.status === BONUS_STATUS.READY && !processed.has(row.usernameKey)
    ),
    sortMode || "DP_DESC"
  );
}

function depositUrl(username) {
  const url = new URL(DEPOSIT_URL);
  url.searchParams.set("role", "sa");
  url.searchParams.set("userName", username);
  url.searchParams.set("pg", "addCreditRequest");
  url.searchParams.set("search", username);
  return url.toString();
}

async function getReusableDepositTab(tabId) {
  if (!Number.isInteger(tabId)) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function openCurrentCandidate(botState, candidate) {
  let tab = await getReusableDepositTab(botState.depositTabId);
  if (!tab) tab = await chrome.tabs.create({ url: "about:blank", active: true });
  const nextState = await updateBotState({
    active: true,
    stage: "NAVIGATING",
    current: publicCurrent(candidate),
    depositTabId: tab.id,
    error: ""
  });
  await chrome.tabs.update(tab.id, { url: depositUrl(candidate.username), active: true });
  return nextState;
}

function inheritedProcessedKeys(previous, queue) {
  if (!previous) return [];
  const sameQueue = previous.queueGeneratedAt && previous.queueGeneratedAt === queue.generatedAt;
  if (sameQueue && ["STOPPED", "SUBMIT_CLICKED", "ADVANCING"].includes(previous.stage)) {
    return previous.processedKeys ?? [];
  }
  // Migrasi state lama: VERIFY_FAILED berarti admin sudah menekan Submit.
  if (["VERIFY_FAILED", "VERIFYING"].includes(previous.stage) && previous.current?.usernameKey) {
    return [previous.current.usernameKey];
  }
  return [];
}

async function startBot(sortMode) {
  const stored = await storageGet(["bonusQueue", "botState"]);
  if (stored.botState?.active) return stored.botState;
  if (!stored.bonusQueue) throw new Error("Bonus Queue belum ada. Jalankan Scan All + Validate dulu.");

  const processedKeys = inheritedProcessedKeys(stored.botState, stored.bonusQueue);
  const candidates = readyRows(stored.bonusQueue, sortMode, processedKeys);
  if (!candidates.length) throw new Error("Tidak ada ID READY yang belum diproses.");
  const base = {
    active: true,
    stage: "STARTING",
    sortMode: sortMode || "DP_DESC",
    current: null,
    depositTabId: stored.botState?.depositTabId ?? null,
    processedKeys,
    completedCount: processedKeys.length,
    queueGeneratedAt: stored.bonusQueue.generatedAt,
    startedAt: new Date().toISOString(),
    error: ""
  };
  await storageSet({ botState: { ...base, updatedAt: new Date().toISOString() } });
  return openCurrentCandidate(base, candidates[0]);
}

async function stopBot(reason = "Dihentikan admin.") {
  return updateBotState({ active: false, stage: "STOPPED", error: reason });
}

async function migrateLegacyVerificationState() {
  const stored = await storageGet(["botState", "bonusQueue"]);
  const previous = stored.botState;
  if (!["VERIFY_FAILED", "VERIFYING"].includes(previous?.stage)) return;
  const processedKeys = [...new Set([
    ...(previous.processedKeys ?? []),
    ...(previous.current?.usernameKey ? [previous.current.usernameKey] : [])
  ])];
  await storageSet({
    botState: {
      ...previous,
      active: false,
      stage: "STOPPED",
      processedKeys,
      completedCount: processedKeys.length,
      queueGeneratedAt: stored.bonusQueue?.generatedAt,
      error: "",
      updatedAt: new Date().toISOString()
    }
  });
}

async function advanceAfterSubmit() {
  if (advanceRunning) return;
  advanceRunning = true;
  try {
    const stored = await storageGet(["botState", "bonusQueue"]);
    let botState = stored.botState;
    if (!botState?.active || botState.stage !== "SUBMIT_CLICKED") return;
    botState = await updateBotState({ stage: "ADVANCING", error: "" });
    const candidates = readyRows(stored.bonusQueue, botState.sortMode, botState.processedKeys);
    if (!candidates.length) {
      await updateBotState({ active: false, stage: "COMPLETE", current: null, error: "" });
      return;
    }
    await openCurrentCandidate(botState, candidates[0]);
  } finally {
    advanceRunning = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    if (message?.type === "BNS_BOT_START") {
      return { ok: true, state: await startBot(message.sortMode) };
    }
    if (message?.type === "BNS_BOT_STOP") {
      return { ok: true, state: await stopBot() };
    }
    if (message?.type === "BNS_BOT_GET_STATE") {
      const { botState } = await storageGet("botState");
      const authorized = Boolean(sender.tab?.id && botState?.depositTabId === sender.tab.id);
      return { ok: true, state: botState ?? null, authorized };
    }
    if (message?.type === "BNS_BOT_FORM_STAGE") {
      const { botState } = await storageGet("botState");
      if (!sender.tab?.id || botState?.depositTabId !== sender.tab.id || !botState.active) {
        throw new Error("Tab ini bukan tab bot yang aktif.");
      }
      if (message.usernameKey !== botState.current?.usernameKey) throw new Error("ID bot tidak cocok.");
      return { ok: true, state: await updateBotState({ stage: message.stage, error: message.error || "" }) };
    }
    if (message?.type === "BNS_BOT_FINAL_SUBMIT") {
      const { botState } = await storageGet("botState");
      if (!sender.tab?.id || botState?.depositTabId !== sender.tab.id || !botState.active) {
        throw new Error("Bot tidak aktif pada tab ini.");
      }
      if (botState.stage !== "READY_TO_SUBMIT") throw new Error("Form belum berstatus READY TO SUBMIT.");
      if (message.usernameKey !== botState.current?.usernameKey) throw new Error("ID submit tidak cocok.");
      const processedKeys = [...new Set([...(botState.processedKeys ?? []), botState.current.usernameKey])];
      const nextState = await updateBotState({
        stage: "SUBMIT_CLICKED",
        processedKeys,
        completedCount: processedKeys.length,
        error: ""
      });
      // Fallback untuk partial postback/AJAX yang tidak memicu tabs.onUpdated.
      setTimeout(() => advanceAfterSubmit(), 5_000);
      return { ok: true, state: nextState };
    }
    return null;
  };

  handle().then(sendResponse).catch((error) => {
    sendResponse({ ok: false, message: error instanceof Error ? error.message : "Bot error." });
  });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  storageGet("botState").then(({ botState }) => {
    if (botState?.depositTabId === tabId && botState.active && botState.stage === "SUBMIT_CLICKED") {
      advanceAfterSubmit();
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  storageGet("botState").then(({ botState }) => {
    if (botState?.active && botState.depositTabId === tabId) {
      stopBot("Tab Deposit Manual ditutup.");
    }
  });
});

migrateLegacyVerificationState();
