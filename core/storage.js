const SNAPSHOT_KEYS = ["dp", "wd", "scb"];

function getStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (value) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(value);
    });
  });
}

function setStorage(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function removeStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

export async function loadState() {
  return getStorage([
    ...SNAPSHOT_KEYS,
    "validation",
    "bonusQueue",
    "bonusAudit",
    "stopBns",
    "botState",
    "autoRefreshSettings",
    "autoRefreshState"
  ]);
}

export async function saveSnapshot(pageType, snapshot) {
  const key = String(pageType).toLocaleLowerCase("en-US");
  if (!SNAPSHOT_KEYS.includes(key)) throw new Error("Unsupported snapshot type.");
  await setStorage({ [key]: snapshot });
  await removeStorage(["validation", "bonusQueue", "bonusAudit", "botState"]);
}

export async function saveDerivedResults(validation, bonusQueue, bonusAudit) {
  await setStorage({ validation, bonusQueue, bonusAudit });
}

export async function saveStopBns(stopBns) {
  await setStorage({ stopBns });
  await removeStorage(["validation", "bonusQueue", "bonusAudit", "botState"]);
}

export async function clearAllData() {
  await removeStorage([...SNAPSHOT_KEYS, "validation", "bonusQueue", "bonusAudit", "botState"]);
}
