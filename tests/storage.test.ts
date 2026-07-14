import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { PdfStorage, EmptyPdfError } from "../src/storage/PdfStorage.js";
import { createLogger } from "../src/utils/Logger.js";
import { loadConfig } from "../src/config/index.js";
import type { ResolutionRow } from "../src/models/Resolution.js";

function makeRow(overrides: Partial<ResolutionRow> = {}): ResolutionRow {
  return {
    numero: 1,
    numeroExpediente: "EXP-2024-001",
    administrado: "EMPRESA",
    unidadFiscalizable: "UNIDAD",
    sector: "MINERÍA",
    numeroResolucion: "RES-1",
    uuid: "62d415af-6462-4b14-9cab-a95717cc91f9",
    pdfButtonId: "listarDetalleInfraccionRAAForm:dt:0:j_idt63",
    ...overrides,
  };
}

describe("PdfStorage", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("escribe el PDF atomicamente y no deja .tmp", async () => {
    dir = await mkdtemp(join(tmpdir(), "pdf-"));
    const storage = new PdfStorage(dir);
    const row = makeRow();
    const path = storage.buildPath(row);

    await storage.savePdf(Readable.from(Buffer.from("%PDF-1.4 fake content")), path);

    const content = await readFile(path, "utf8");
    expect(content).toContain("fake content");

    const files = await readdir(dir);
    expect(files).toContain("EXP-2024-001_62d415af-6462-4b14-9cab-a95717cc91f9.pdf");
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("lanza EmptyPdfError y limpia el .tmp si el stream esta vacio", async () => {
    dir = await mkdtemp(join(tmpdir(), "pdf-"));
    const storage = new PdfStorage(dir);
    const row = makeRow();

    await expect(
      storage.savePdf(Readable.from(Buffer.from("")), storage.buildPath(row))
    ).rejects.toThrow(EmptyPdfError);

    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith(".pdf"))).toBe(false);
  });

  it("sanitiza el nombre de expediente para el nombre de archivo", async () => {
    dir = await mkdtemp(join(tmpdir(), "pdf-"));
    const storage = new PdfStorage(dir);
    const row = makeRow({ numeroExpediente: "EXP/2024:001*" });

    const path = storage.buildPath(row);
    await storage.savePdf(Readable.from(Buffer.from("x")), path);

    const files = await readdir(dir);
    expect(files[0]).toBe("EXP_2024_001__62d415af-6462-4b14-9cab-a95717cc91f9.pdf");
  });
});
