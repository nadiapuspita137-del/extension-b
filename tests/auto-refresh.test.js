import test from "node:test";
import assert from "node:assert/strict";

import {
  acquireRefreshLock,
  AUTO_REFRESH_ALARM,
  configureAutoRefresh,
  releaseRefreshLock
} from "../bot/auto-refresh.js";

function installChromeMock(initial = {}) {
  const values = { ...initial };
  const alarms = new Map();
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const requested = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(requested.filter((key) => key in values).map((key) => [key, values[key]]));
        },
        async set(next) {
          Object.assign(values, next);
        }
      }
    },
    alarms: {
      async clear(name) {
        return alarms.delete(name);
      },
      async create(name, info) {
        alarms.set(name, {
          name,
          periodInMinutes: info.periodInMinutes,
          scheduledTime: Date.now() + (info.delayInMinutes ?? info.periodInMinutes) * 60_000
        });
      },
      async get(name) {
        return alarms.get(name);
      }
    }
  };
  return { values, alarms };
}

test("Auto Refresh configuration persists interval and creates an alarm", async () => {
  const mock = installChromeMock();
  const configured = await configureAutoRefresh(true, 10);

  assert.equal(configured.settings.enabled, true);
  assert.equal(configured.settings.intervalMinutes, 10);
  assert.equal(mock.values.autoRefreshSettings.intervalMinutes, 10);
  assert.equal(mock.alarms.get(AUTO_REFRESH_ALARM).periodInMinutes, 10);
});

test("Auto Refresh defers without taking a lock while bot is active", async () => {
  const mock = installChromeMock({ botState: { active: true } });
  const lock = await acquireRefreshLock("AUTO");

  assert.equal(lock.ok, false);
  assert.equal(lock.deferred, true);
  assert.equal(mock.values.autoRefreshState.running, false);
  assert.equal(mock.values.autoRefreshState.status, "DEFERRED_BOT");
});

test("a persisted manual RUNNING state is recovered after its popup was closed", async () => {
  const mock = installChromeMock({
    autoRefreshState: {
      running: true,
      status: "RUNNING",
      trigger: "MANUAL",
      progress: "Scan manual sedang berjalan…",
      updatedAt: new Date().toISOString()
    }
  });

  const lock = await acquireRefreshLock("MANUAL");
  assert.equal(lock.ok, true);
  assert.equal(mock.values.autoRefreshState.running, true);
  assert.equal(mock.values.autoRefreshState.status, "RUNNING");
  await releaseRefreshLock();
});
