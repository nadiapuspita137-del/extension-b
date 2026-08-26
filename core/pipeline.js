import {
  isDailyBonusToBank,
  isManualDepositToBank,
  normalizeExtractedRows
} from "./normalize.js";
import { validateSnapshots } from "./validator.js";
import { buildBonusQueue } from "./bonus.js";
import { auditBonusPayments } from "./audit.js";

export function createSnapshot(response, capturedAt = new Date().toISOString()) {
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
    capturedAt,
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
        excludedInternalScbRows:
          sourceRows.length - selectedRows.length - manualDepositSourceRows.length
      } : {})
    }
  };
}

export function buildDerivedResults(state, generatedAt = new Date().toISOString()) {
  const missing = ["dp", "wd", "scb"].filter((key) => !state[key]);
  if (missing.length) {
    throw new Error(`${missing.map((key) => key.toUpperCase()).join(", ")} snapshot missing.`);
  }

  const combinedDepositRows = [
    ...state.dp.rows,
    ...(state.scb.manualDepositRows ?? [])
  ];
  const stopBnsRows = state.stopBns?.ids ?? [];
  const sourceCapturedAt = {
    dp: state.dp.capturedAt,
    wd: state.wd.capturedAt,
    scb: state.scb.capturedAt
  };

  const validation = validateSnapshots(
    combinedDepositRows,
    state.wd.rows,
    state.scb.rows,
    stopBnsRows
  );
  validation.stats.rawDp =
    (state.dp.rawRowCount ?? state.dp.rows.length) +
    (state.scb.manualDepositRows?.length ?? 0);
  validation.stats.invalidAmounts =
    (state.dp.invalidAmounts ?? 0) +
    (state.scb.manualDepositInvalidAmounts ?? 0);
  validation.runAt = generatedAt;
  validation.sourceCapturedAt = { ...sourceCapturedAt };

  const bonusQueue = buildBonusQueue(
    combinedDepositRows,
    state.wd.rows,
    state.scb.rows,
    stopBnsRows
  );
  bonusQueue.generatedAt = generatedAt;
  bonusQueue.sourceCapturedAt = { ...sourceCapturedAt };

  const bonusAudit = auditBonusPayments(
    combinedDepositRows,
    state.wd.rows,
    state.scb.rows,
    stopBnsRows
  );
  bonusAudit.generatedAt = generatedAt;
  bonusAudit.sourceCapturedAt = { ...sourceCapturedAt };

  return { validation, bonusQueue, bonusAudit };
}
