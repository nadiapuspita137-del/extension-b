(() => {
  if (globalThis.__BNS_VALIDATOR_SCANNER_INSTALLED__) return;
  globalThis.__BNS_VALIDATOR_SCANNER_INSTALLED__ = true;

  const normalizeText = (value) =>
    String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("en-US");

  const cellText = (cell) => String(cell?.innerText ?? cell?.textContent ?? "").trim();

  const isUsernameHeader = (value) => {
    const text = normalizeText(value);
    return text === "user name" || text === "username" || text.startsWith("user name ");
  };

  const isDepositHeader = (value) => {
    const text = normalizeText(value);
    return text === "deposit" || text.startsWith("deposit ");
  };

  const isWithdrawHeader = (value) => {
    const text = normalizeText(value);
    return (
      text === "withdraw amount" ||
      text === "withdrawal amount" ||
      text.startsWith("withdraw amount ") ||
      text.startsWith("withdrawal amount ")
    );
  };

  const isDatetimeHeader = (value) => {
    const text = normalizeText(value).replace(/\s*\/\s*/g, "/");
    return (
      text === "date/time" ||
      text === "date time" ||
      text === "datetime" ||
      text.startsWith("date/time ")
    );
  };

  function describeHeaderRow(row, rowIndex) {
    const headers = Array.from(row.cells ?? []).map(cellText);
    const usernameIndex = headers.findIndex(isUsernameHeader);
    const depositIndex = headers.findIndex(isDepositHeader);
    const withdrawIndex = headers.findIndex(isWithdrawHeader);
    const datetimeIndex = headers.findIndex(isDatetimeHeader);
    const amountIndex = withdrawIndex >= 0 ? withdrawIndex : depositIndex;

    return {
      rowIndex,
      headers,
      usernameIndex,
      depositIndex,
      withdrawIndex,
      datetimeIndex,
      amountIndex,
      valid: usernameIndex >= 0 && amountIndex >= 0
    };
  }

  function findTable() {
    const tables = Array.from(document.querySelectorAll("table"));
    const candidates = [];

    for (const table of tables) {
      const rows = Array.from(table.rows ?? []);
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const header = describeHeaderRow(rows[rowIndex], rowIndex);
        if (!header.valid) continue;

        let score = 10;
        if (table.id === "AddCreditHistory_cm1_g") score += 10;
        if (header.datetimeIndex >= 0) score += 2;
        if (header.withdrawIndex >= 0) score += 3;
        candidates.push({ table, header, score });
        break;
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] ?? null;
  }

  function detectPageType(tableInfo) {
    if (!tableInfo) return "UNKNOWN";
    if (tableInfo.header.withdrawIndex >= 0) return "WD";

    const pageUrl = String(location.href);
    const formActions = Array.from(document.forms)
      .map((form) => String(form.getAttribute("action") ?? form.action ?? ""))
      .join(" ");
    const context = `${pageUrl} ${formActions}`.toLocaleLowerCase("en-US");
    const headers = tableInfo.header.headers.map(normalizeText);

    if (context.includes("washcredithistory")) return "WD";
    if (/[?&]isabd=1(?:&|\s|$)/i.test(context)) return "DP";
    if (headers.some((header) => header === "rrn" || header.startsWith("rrn "))) return "DP";
    if (headers.some((header) => header === "reference" || header.startsWith("reference "))) return "DP";
    if (headers.some((header) => header === "edited by" || header.startsWith("edited by "))) return "SCB";
    if (context.includes("addcredithistory2.aspx")) return "SCB";
    return "UNKNOWN";
  }

  function extractRows(tableInfo) {
    const { table, header } = tableInfo;
    const rows = Array.from(table.rows ?? []).slice(header.rowIndex + 1);
    const extracted = [];
    let skippedWithoutUsername = 0;
    let sourceRowCount = 0;

    for (const row of rows) {
      const cells = Array.from(row.cells ?? []);
      if (cells.length <= Math.max(header.usernameIndex, header.amountIndex)) continue;

      const username = cellText(cells[header.usernameIndex]);
      if (isUsernameHeader(username)) continue;
      sourceRowCount += 1;
      if (!username || isUsernameHeader(username)) {
        skippedWithoutUsername += 1;
        continue;
      }

      extracted.push({
        username,
        amountText: cellText(cells[header.amountIndex]),
        datetime: header.datetimeIndex >= 0 ? cellText(cells[header.datetimeIndex]) : ""
      });
    }

    return { rows: extracted, skippedWithoutUsername, sourceRowCount };
  }

  function scanCurrentPage() {
    const tableInfo = findTable();
    if (!tableInfo) {
      return { ok: false, code: "TABLE_NOT_FOUND", message: "Table not found." };
    }

    const pageType = detectPageType(tableInfo);
    if (pageType === "UNKNOWN") {
      return { ok: false, code: "UNSUPPORTED_PAGE", message: "Unsupported page." };
    }

    const extracted = extractRows(tableInfo);
    return {
      ok: true,
      pageType,
      rows: extracted.rows,
      empty: extracted.rows.length === 0,
      message: extracted.rows.length === 0 ? "No transaction rows found." : "",
      skippedWithoutUsername: extracted.skippedWithoutUsername,
      sourceRowCount: extracted.sourceRowCount,
      source: {
        pageUrl: location.href,
        tableId: tableInfo.table.id || "(no id)",
        headers: tableInfo.header.headers,
        columns: {
          username: tableInfo.header.usernameIndex,
          amount: tableInfo.header.amountIndex,
          datetime: tableInfo.header.datetimeIndex
        }
      }
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "BNS_SCAN_CURRENT_PAGE") return false;
    try {
      sendResponse(scanCurrentPage());
    } catch (error) {
      sendResponse({
        ok: false,
        code: "SCAN_FAILED",
        message: error instanceof Error ? error.message : "Scan failed."
      });
    }
    return false;
  });
})();
