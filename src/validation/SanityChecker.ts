import type { Logger } from "../utils/Logger.js";
import type { ResolutionRow } from "../models/Resolution.js";

export interface MissingFieldsEntry {
  uuid: string;
  fields: string[];
}

export interface SanityReport {
  duplicateUuids: string[];
  duplicateExpedientes: string[];
  missingRequiredFields: MissingFieldsEntry[];
  totalMismatch: { expected: number; actual: number } | null;
  issues: string[];
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

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
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
    expectedTotal?: number | null
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

    let totalMismatch: { expected: number; actual: number } | null = null;
    if (expectedTotal != null && expectedTotal !== rows.length) {
      totalMismatch = { expected: expectedTotal, actual: rows.length };
    }

    const issues: string[] = [];
    if (duplicateUuids.length > 0) {
      issues.push(`UUIDs duplicados: ${duplicateUuids.join(", ")}`);
    }
    if (duplicateExpedientes.length > 0) {
      issues.push(`Expedientes duplicados: ${duplicateExpedientes.join(", ")}`);
    }
    if (missingRequiredFields.length > 0) {
      issues.push(
        `${missingRequiredFields.length} fila(s) con campos requeridos vacios`
      );
    }
    if (totalMismatch) {
      issues.push(
        `Total esperado ${totalMismatch.expected} != obtenido ${totalMismatch.actual}`
      );
    }

    this.logger.info(
      {
        duplicateUuids: duplicateUuids.length,
        duplicateExpedientes: duplicateExpedientes.length,
        missingRequiredFields: missingRequiredFields.length,
        totalMismatch,
        issueCount: issues.length,
      },
      "Sanity check de filas completado"
    );

    return {
      duplicateUuids,
      duplicateExpedientes,
      missingRequiredFields,
      totalMismatch,
      issues,
    };
  }

  assertValid(rows: readonly ResolutionRow[], expectedTotal?: number | null): void {
    const report = this.checkRows(rows, expectedTotal);
    if (report.issues.length > 0) {
      throw new SanityError(report);
    }
  }
}
