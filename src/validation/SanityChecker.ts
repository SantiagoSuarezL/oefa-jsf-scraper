import type { Logger } from "../utils/Logger.js";
import type { ResolutionRow } from "../models/Resolution.js";

export interface MissingFieldsEntry {
  uuid: string | undefined;
  fields: string[];
}

export interface SanityReport {
  totalRows: number;
  uniqueUuids: number;
  uniqueExpedientes: number;
  duplicateUuidCount: number;
  duplicateUuids: string[];
  duplicateExpedienteCount: number;
  duplicateExpedientes: string[];
  missingRequiredFieldsCount: number;
  missingRequiredFields: MissingFieldsEntry[];
  missingByField: Record<string, number>;
  noPdfCount: number;
  totalInTable: number;
  expectedDownloadableRows: number | null;
  expectedUniqueRows: number | null;
  actualUniqueRows: number;
  removedDuplicateUuidRows: number;
  totalMismatch: { expected: number; actual: number } | null;
  issues: string[];
  warnings: string[];
  summary: string[];
}

export class SanityError extends Error {
  constructor(public readonly report: SanityReport) {
    super(
      `Sanity check fallido (${report.issues.length}): ${report.issues.join("; ")}`
    );
    this.name = "SanityError";
  }
}

const REQUIRED_FIELDS: Array<keyof ResolutionRow> = [
  "numeroExpediente",
  "sector",
  "numeroResolucion",
  "uuid",
];

function findDuplicates(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (value == null) continue;
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates];
}

function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export class SanityChecker {
  constructor(private readonly logger: Logger) {}

  checkRows(
    rows: readonly ResolutionRow[],
    expectedTotal?: number | null,
    noPdfCount = 0,
    removedDuplicateUuidRows = 0
  ): SanityReport {
    const duplicateUuids = findDuplicates(rows.map((row) => row.uuid));
    const duplicateExpedientes = findDuplicates(
      rows.map((row) => row.numeroExpediente)
    );

    const missingRequiredFields: MissingFieldsEntry[] = rows
      .filter((row) =>
        REQUIRED_FIELDS.some((field) => isEmpty(row[field]))
      )
      .map((row) => ({
        uuid: row.uuid,
        fields: REQUIRED_FIELDS.filter((field) => isEmpty(row[field])),
      }));

    const missingByField: Record<string, number> = {};
    for (const entry of missingRequiredFields) {
      for (const field of entry.fields) {
        missingByField[field] = (missingByField[field] ?? 0) + 1;
      }
    }

    const uniqueUuids = new Set(rows.map((row) => row.uuid)).size;
    const uniqueExpedientes = new Set(rows.map((row) => row.numeroExpediente)).size;

    let expectedDownloadableRows: number | null = null;
    let expectedUniqueRows: number | null = null;
    let totalMismatch: { expected: number; actual: number } | null = null;
    if (expectedTotal != null) {
      expectedDownloadableRows = Math.max(expectedTotal - noPdfCount, 0);
      expectedUniqueRows = Math.max(expectedDownloadableRows - removedDuplicateUuidRows, 0);
      if (expectedUniqueRows !== uniqueUuids) {
        totalMismatch = { expected: expectedUniqueRows, actual: uniqueUuids };
      }
    }

    const issues: string[] = [];
    const warnings: string[] = [];
    if (duplicateUuids.length > 0) {
      issues.push(
        `${duplicateUuids.length} UUIDs duplicados: ${duplicateUuids.join(", ")}`
      );
    }
    if (duplicateExpedientes.length > 0) {
      warnings.push(
        `${duplicateExpedientes.length} expedientes duplicados: ${duplicateExpedientes.join(", ")}`
      );
    }
    if (missingRequiredFields.length > 0) {
      const byField = Object.entries(missingByField)
        .map(([field, count]) => `${field}=${count}`)
        .join(", ");
      issues.push(
        `${missingRequiredFields.length} fila(s) con campos requeridos vacios (${byField})`
      );
    }
    if (totalMismatch) {
      issues.push(
        `Total esperado ${totalMismatch.expected} != obtenido ${totalMismatch.actual}`
      );
    }

    const summary = this.buildSummary({
      portalTotal: expectedTotal ?? null,
      noPdfCount,
      downloadableExpected: expectedDownloadableRows,
      removedDuplicateUuidRows,
      expectedUniqueRows,
      actualUniqueRows: uniqueUuids,
      duplicateExpedienteCount: duplicateExpedientes.length,
      pass: issues.length === 0,
    });

    this.logger.info(
      {
        totalRows: rows.length,
        uniqueUuids,
        uniqueExpedientes,
        duplicateUuidCount: duplicateUuids.length,
        duplicateExpedienteCount: duplicateExpedientes.length,
        missingRequiredFields: missingRequiredFields.length,
        missingByField,
        noPdfCount,
        totalInTable: rows.length + noPdfCount,
        expectedDownloadableRows,
        expectedUniqueRows,
        actualUniqueRows: uniqueUuids,
        removedDuplicateUuidRows,
        totalMismatch,
        warnings: warnings.length,
        issueCount: issues.length,
        summary,
      },
      "Sanity check de filas completado"
    );

    return {
      totalRows: rows.length,
      uniqueUuids,
      uniqueExpedientes,
      duplicateUuidCount: duplicateUuids.length,
      duplicateUuids,
      duplicateExpedienteCount: duplicateExpedientes.length,
      duplicateExpedientes,
      missingRequiredFieldsCount: missingRequiredFields.length,
      missingRequiredFields,
      missingByField,
      noPdfCount,
      totalInTable: rows.length + noPdfCount,
      expectedDownloadableRows,
      expectedUniqueRows,
      actualUniqueRows: uniqueUuids,
      removedDuplicateUuidRows,
      totalMismatch,
      issues,
      warnings,
      summary,
    };
  }

  assertValid(
    rows: readonly ResolutionRow[],
    expectedTotal?: number | null,
    noPdfCount = 0,
    removedDuplicateUuidRows = 0
  ): SanityReport {
    const report = this.checkRows(rows, expectedTotal, noPdfCount, removedDuplicateUuidRows);
    if (report.issues.length > 0) {
      throw new SanityError(report);
    }
    return report;
  }

  private buildSummary(input: {
    portalTotal: number | null;
    noPdfCount: number;
    downloadableExpected: number | null;
    removedDuplicateUuidRows: number;
    expectedUniqueRows: number | null;
    actualUniqueRows: number;
    duplicateExpedienteCount: number;
    pass: boolean;
  }): string[] {
    const padTo = (label: string, value: unknown): string => {
      const str = typeof value === "number" ? value.toLocaleString("es-PE") : String(value);
      return `${label.padEnd(23)}${str}`;
    };

    const lines: string[] = [];
    lines.push(padTo("Portal rows..............", input.portalTotal == null ? "?" : input.portalTotal));
    lines.push(padTo("Rows without PDF.........", input.noPdfCount));
    lines.push(padTo("Downloadable rows........", input.downloadableExpected == null ? "?" : input.downloadableExpected));
    lines.push(padTo("Duplicate UUID rows......", input.removedDuplicateUuidRows));
    lines.push(padTo("Expected unique PDFs.....", input.expectedUniqueRows == null ? "?" : input.expectedUniqueRows));
    lines.push(padTo("Actual unique PDFs.......", input.actualUniqueRows));
    lines.push(padTo("Duplicate expedientes....", `${input.duplicateExpedienteCount} (warning)`));
    lines.push(padTo("Sanity result............", input.pass ? "PASS" : "FAIL"));
    return lines;
  }
}
