import { describe, expect, it } from "vitest";
import {
  SanityChecker,
  SanityError,
} from "../src/validation/SanityChecker.js";
import { createLogger } from "../src/utils/Logger.js";
import { loadConfig } from "../src/config/index.js";
import type { ResolutionRow } from "../src/models/Resolution.js";

function row(uuid: string, expediente: string, overrides: Partial<ResolutionRow> = {}): ResolutionRow {
  return {
    numero: 1,
    numeroExpediente: expediente,
    administrado: "EMPRESA",
    unidadFiscalizable: "UNIDAD",
    sector: "MINERÍA",
    numeroResolucion: "RES-1",
    uuid,
    pdfButtonId: `btn-${uuid}`,
    ...overrides,
  };
}

function makeChecker(): SanityChecker {
  process.env.OEFA_BASE_URL = "https://example.com/x.xhtml";
  return new SanityChecker(createLogger(loadConfig()));
}

describe("SanityChecker.checkRows", () => {
  it("no reporta issues cuando todo es consistente", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1"), row("u2", "E2"), row("u3", "E3")];
    const report = checker.checkRows(rows, 3);
    expect(report.issues).toEqual([]);
    expect(report.duplicateUuids).toEqual([]);
    expect(report.duplicateExpedientes).toEqual([]);
    expect(report.totalMismatch).toBeNull();
  });

  it("detecta UUIDs duplicados", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1"), row("u1", "E2")];
    const report = checker.checkRows(rows);
    expect(report.duplicateUuids).toEqual(["u1"]);
    expect(report.issues.some((i) => i.includes("UUIDs duplicados"))).toBe(true);
  });

  it("detecta expedientes duplicados como warning (no issue)", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1"), row("u2", "E1")];
    const report = checker.checkRows(rows);
    expect(report.duplicateExpedientes).toEqual(["E1"]);
    expect(report.warnings.some((w) => w.includes("expedientes duplicados"))).toBe(true);
    expect(report.issues.some((i) => i.includes("expedientes duplicados"))).toBe(false);
  });

  it("reconcilia totalMismatch contra filas descargables (expectedTotal - noPdfCount)", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1")];
    // expected 1753, noPdf 132 → downloadable esperado 1621 != 1 fila actual
    const report = checker.checkRows(rows, 1753, 132);
    expect(report.expectedDownloadableRows).toBe(1621);
    expect(report.totalMismatch).toEqual({ expected: 1621, actual: 1 });
  });

  it("no reporta totalMismatch cuando filas == expectedDownloadableRows", () => {
    const checker = makeChecker();
    const rows = Array.from({ length: 1621 }, (_, i) => row(`u${i}`, `E${i}`));
    const report = checker.checkRows(rows, 1753, 132);
    expect(report.expectedDownloadableRows).toBe(1621);
    expect(report.totalMismatch).toBeNull();
    expect(report.issues).not.toContain(
      expect.stringContaining("Total esperado")
    );
  });

  it("construye summary con métricas explícitas", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1"), row("u1", "E2"), row("u3", "E3")];
    const report = checker.checkRows(rows, 1753, 132);
    expect(report.summary).toBeInstanceOf(Array);
    expect(report.summary.length).toBe(8);
    expect(report.summary.some((l) => l.includes("Portal rows"))).toBe(true);
    expect(report.summary.some((l) => l.includes("Rows without PDF"))).toBe(true);
    expect(report.summary.some((l) => l.includes("Downloadable rows"))).toBe(true);
    expect(report.summary.some((l) => l.includes("Duplicate UUID rows"))).toBe(true);
    expect(report.summary.some((l) => l.includes("Expected unique PDFs"))).toBe(true);
    expect(report.summary.some((l) => l.includes("Actual unique PDFs"))).toBe(true);
    expect(report.summary.some((l) => l.includes("Duplicate expedientes"))).toBe(true);
    expect(report.summary.some((l) => l.includes("Sanity result"))).toBe(true);
  });

  it("reconcilia contra filas unicas (downloadable - duplicados removidos)", () => {
    const checker = makeChecker();
    // 1753 portal, 132 sin PDF → 1621 descargables; 12 UUIDs duplicados removidos
    // → 1609 únicas esperadas. Filas dedupicadas = 1609 → sin mismatch.
    const rows = Array.from({ length: 1609 }, (_, i) => row(`u${i}`, `E${i}`));
    const report = checker.checkRows(rows, 1753, 132, 12);
    expect(report.expectedDownloadableRows).toBe(1621);
    expect(report.expectedUniqueRows).toBe(1609);
    expect(report.actualUniqueRows).toBe(1609);
    expect(report.removedDuplicateUuidRows).toBe(12);
    expect(report.totalMismatch).toBeNull();
  });

  it("reporta totalMismatch cuando filas unicas != esperadas", () => {
    const checker = makeChecker();
    const rows = Array.from({ length: 1600 }, (_, i) => row(`u${i}`, `E${i}`));
    const report = checker.checkRows(rows, 1753, 132, 12);
    expect(report.expectedUniqueRows).toBe(1609);
    expect(report.actualUniqueRows).toBe(1600);
    expect(report.totalMismatch).toEqual({ expected: 1609, actual: 1600 });
  });

  it("detecta campos requeridos vacios", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1", { sector: "" })];
    const report = checker.checkRows(rows);
    expect(report.missingRequiredFields).toHaveLength(1);
    expect(report.missingRequiredFields[0]?.fields).toContain("sector");
  });

  it("reporte detallado incluye totales, noPdfCount y totalInTable", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1"), row("u1", "E2"), row("u3", "E3")];
    const report = checker.checkRows(rows, 3, 5);
    expect(report.totalRows).toBe(3);
    expect(report.uniqueUuids).toBe(2);
    expect(report.duplicateUuidCount).toBe(1);
    expect(report.noPdfCount).toBe(5);
    expect(report.totalInTable).toBe(8); // 3 filas + 5 sin PDF
    expect(report.missingByField).toEqual({});
  });

  it("assertValid lanza SanityError si hay issues", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1"), row("u1", "E2")];
    expect(() => checker.assertValid(rows)).toThrow(SanityError);
    expect(() => checker.assertValid(rows)).toThrow(/UUIDs duplicados/);
  });

  it("assertValid no lanza si no hay issues", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1"), row("u2", "E2")];
    expect(() => checker.assertValid(rows, 2)).not.toThrow();
  });

  it("assertValid no lanza por expedientes duplicados (UUIDs unicos)", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1"), row("u2", "E1")];
    expect(() => checker.assertValid(rows)).not.toThrow();
  });

  it("assertValid no lanza en modo reconciliado cuando filas == expectedDownloadableRows", () => {
    const checker = makeChecker();
    const rows = Array.from({ length: 5 }, (_, i) => row(`u${i}`, `E${i}`));
    // 7 total portal, 2 sin PDF → 5 descargables esperados == 5 filas
    expect(() => checker.assertValid(rows, 7, 2)).not.toThrow();
  });
});
