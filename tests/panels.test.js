import test from "node:test";
import assert from "node:assert/strict";

import { configuredPageType, PANEL_URLS } from "../core/panels.js";

test("configured one-click URLs map to DP, WD, and SCB", () => {
  assert.equal(configuredPageType(PANEL_URLS.DP), "DP");
  assert.equal(configuredPageType(PANEL_URLS.WD), "WD");
  assert.equal(configuredPageType(PANEL_URLS.SCB), "SCB");
});

test("page mapping rejects other origins and unsupported paths", () => {
  assert.equal(configuredPageType("https://other.example/_SubAg_Sub/WashCreditHistory.aspx"), null);
  assert.equal(configuredPageType("https://bfj.porta-assist.com/_SubAg_Sub/Home.aspx"), null);
});
