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

  it("detecta expedientes duplicados", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1"), row("u2", "E1")];
    const report = checker.checkRows(rows);
    expect(report.duplicateExpedientes).toEqual(["E1"]);
  });

  it("detecta total esperado distinto al obtenido", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1")];
    const report = checker.checkRows(rows, 1753);
    expect(report.totalMismatch).toEqual({ expected: 1753, actual: 1 });
  });

  it("detecta campos requeridos vacios", () => {
    const checker = makeChecker();
    const rows = [row("u1", "E1", { sector: "" })];
    const report = checker.checkRows(rows);
    expect(report.missingRequiredFields).toHaveLength(1);
    expect(report.missingRequiredFields[0]?.fields).toContain("sector");
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
});
