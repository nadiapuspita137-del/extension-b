import { PANEL_TYPES } from "../core/panels.js";
import { scanAllConfiguredPanels } from "../core/panel-scan.js";
import { buildDerivedResults, createSnapshot } from "../core/pipeline.js";

export const AUTO_REFRESH_ALARM = "bns-auto-refresh";
export const AUTO_REFRESH_RETRY_ALARM = "bns-auto-refresh-after-bot";
export const AUTO_REFRESH_INTERVALS = Object.freeze([5, 10, 15, 30, 60]);

let runtimeLock = false;

function nowIso() {
  return new Date().toISOString();
}

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(value) {
  return chrome.storage.local.set(value);
}

function validInterval(value) {
  const interval = Number(value);
  return AUTO_REFRESH_INTERVALS.includes(interval) ? interval : 15;
}

async function alarmNextRunAt() {
  const alarm = await chrome.alarms.get(AUTO_REFRESH_ALARM);
  return alarm?.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : null;
}

async function patchRefreshState(patch) {
  const { autoRefreshState = {} } = await storageGet("autoRefreshState");
  const next = { ...autoRefreshState, ...patch, updatedAt: nowIso() };
  await storageSet({ autoRefreshState: next });
  return next;
}

export async function configureAutoRefresh(enabled, intervalValue) {
  const intervalMinutes = validInterval(intervalValue);
  const settings = {
    enabled: Boolean(enabled),
    intervalMinutes,
    updatedAt: nowIso()
  };

  if (runtimeLock) {
    throw new Error("Refresh sedang berjalan. Tunggu sampai selesai sebelum mengubah jadwal.");
  }
  await recoverInterruptedRefresh();

  await storageSet({ autoRefreshSettings: settings });
  await chrome.alarms.clear(AUTO_REFRESH_ALARM);
  await chrome.alarms.clear(AUTO_REFRESH_RETRY_ALARM);

  if (settings.enabled) {
    await chrome.alarms.create(AUTO_REFRESH_ALARM, {
      delayInMinutes: intervalMinutes,
      periodInMinutes: intervalMinutes
    });
  }

  const state = await patchRefreshState({
    running: false,
    status: settings.enabled ? "IDLE" : "DISABLED",
    progress: "",
    lastError: "",
    nextRunAt: settings.enabled ? await alarmNextRunAt() : null
  });
  return { settings, state };
}

export async function ensureAutoRefreshAlarm() {
  await recoverInterruptedRefresh();
  const { autoRefreshSettings } = await storageGet("autoRefreshSettings");
  if (!autoRefreshSettings?.enabled) {
    await chrome.alarms.clear(AUTO_REFRESH_ALARM);
    return;
  }

  const intervalMinutes = validInterval(autoRefreshSettings.intervalMinutes);
  const existing = await chrome.alarms.get(AUTO_REFRESH_ALARM);
  if (!existing || existing.periodInMinutes !== intervalMinutes) {
    await chrome.alarms.create(AUTO_REFRESH_ALARM, {
      delayInMinutes: intervalMinutes,
      periodInMinutes: intervalMinutes
    });
  }
  await patchRefreshState({ nextRunAt: await alarmNextRunAt() });
}

export async function acquireRefreshLock(trigger) {
  const stored = await storageGet(["botState", "autoRefreshState"]);
  if (stored.botState?.active) {
    if (trigger === "AUTO") {
      await patchRefreshState({
        running: false,
        status: "DEFERRED_BOT",
        progress: "",
        lastAttemptAt: nowIso(),
        lastError: ""
      });
    }
    return { ok: false, deferred: true, message: "Bonus Input Bot sedang aktif." };
  }

  if (runtimeLock) {
    return { ok: false, busy: true, message: "Refresh lain sedang berjalan." };
  }

  if (stored.autoRefreshState?.running) {
    await patchRefreshState({
      running: false,
      status: "INTERRUPTED",
      progress: "",
      lastError: "Scan sebelumnya terputus dan sudah dipulihkan otomatis."
    });
  }

  runtimeLock = true;
  await patchRefreshState({
    running: true,
    status: "RUNNING",
    trigger,
    progress: trigger === "AUTO" ? "Auto Refresh mulai memindai history…" : "Scan manual sedang berjalan…",
    lastAttemptAt: nowIso(),
    lastError: ""
  });

  const { botState } = await storageGet("botState");
  if (botState?.active) {
    runtimeLock = false;
    await patchRefreshState(
      trigger === "AUTO"
        ? { running: false, status: "DEFERRED_BOT", progress: "" }
        : { running: false, status: "IDLE", progress: "" }
    );
    return { ok: false, deferred: true, message: "Bonus Input Bot baru saja diaktifkan." };
  }
  return { ok: true };
}

export async function releaseRefreshLock(status = "IDLE", lastError = "") {
  runtimeLock = false;
  return patchRefreshState({
    running: false,
    status,
    progress: "",
    lastError,
    nextRunAt: await alarmNextRunAt()
  });
}

export async function recoverInterruptedRefresh() {
  if (runtimeLock) return null;
  const { autoRefreshState } = await storageGet("autoRefreshState");
  if (!autoRefreshState?.running) return autoRefreshState ?? null;
  return patchRefreshState({
    running: false,
    status: "INTERRUPTED",
    progress: "",
    lastError: "Scan sebelumnya terputus dan sudah dipulihkan otomatis."
  });
}

async function runRefresh(trigger) {
  if (trigger === "AUTO") {
    const { autoRefreshSettings } = await storageGet("autoRefreshSettings");
    if (!autoRefreshSettings?.enabled) return { ok: false, disabled: true };
  }

  const lock = await acquireRefreshLock(trigger);
  if (!lock.ok) return lock;

  try {
    const responses = await scanAllConfiguredPanels((message) => {
      patchRefreshState({ progress: message }).catch(() => {});
    });
    const capturedAt = nowIso();
    const snapshots = {};
    for (const [type, response] of responses) {
      snapshots[type.toLocaleLowerCase("en-US")] = createSnapshot(response, capturedAt);
    }

    const stored = await storageGet(["stopBns"]);
    const derived = buildDerivedResults({ ...stored, ...snapshots }, capturedAt);
    const nextRunAt = await alarmNextRunAt();
    const rowSummary = PANEL_TYPES.map((type) => {
      const snapshot = snapshots[type.toLocaleLowerCase("en-US")];
      const pages = snapshot.source?.pagesScanned ?? 1;
      return `${type} ${snapshot.rows.length}${pages > 1 ? ` (${pages} pages)` : ""}`;
    }).join(" · ");

    runtimeLock = false;
    await storageSet({
      ...snapshots,
      ...derived,
      autoRefreshState: {
        running: false,
        status: "SUCCESS",
        trigger,
        progress: "",
        lastAttemptAt: capturedAt,
        lastSuccessAt: capturedAt,
        lastError: "",
        nextRunAt,
        summary: rowSummary,
        updatedAt: nowIso()
      }
    });
    return {
      ok: true,
      summary: rowSummary,
      validationStats: derived.validation.stats,
      bonusQueueStats: derived.bonusQueue.stats,
      bonusAuditStats: derived.bonusAudit.stats
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto Refresh gagal.";
    await releaseRefreshLock("ERROR", message);
    return { ok: false, message };
  }
}

export function runAutoRefresh() {
  return runRefresh("AUTO");
}

export function runManualRefresh() {
  return runRefresh("MANUAL");
}

export async function scheduleRefreshAfterBot() {
  const stored = await storageGet(["autoRefreshSettings", "autoRefreshState"]);
  if (!stored.autoRefreshSettings?.enabled) return;
  if (stored.autoRefreshState?.status !== "DEFERRED_BOT") return;
  await chrome.alarms.create(AUTO_REFRESH_RETRY_ALARM, { delayInMinutes: 0.5 });
  await patchRefreshState({
    nextRunAt: new Date(Date.now() + 30_000).toISOString(),
    progress: "Bot berhenti; refresh dijadwalkan sekitar 30 detik lagi."
  });
}
