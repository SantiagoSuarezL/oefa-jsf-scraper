import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDownloadedPdfs } from "../src/validation/PdfValidator.js";
import type { ResolutionRow } from "../src/models/Resolution.js";

function row(uuid: string, expediente: string): ResolutionRow {
  return {
    numero: 1,
    numeroExpediente: expediente,
    administrado: "EMPRESA",
    unidadFiscalizable: "UNIDAD",
    sector: "MINERÍA",
    numeroResolucion: "RES-1",
    uuid,
    pdfButtonId: `btn-${uuid}`,
  };
}

function resolvePath(row: ResolutionRow): string {
  return join(dir, `${row.numeroExpediente}_${row.uuid}.pdf`);
}

let dir: string;

describe("validateDownloadedPdfs", () => {
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("devuelve los paths que faltan o estan vacios", async () => {
    dir = await mkdtemp(join(tmpdir(), "pdfv-"));
    const ok = row("u1", "E1");
    const empty = row("u2", "E2");
    const missing = row("u3", "E3");

    await writeFile(resolvePath(ok), "%PDF-1.4 ok");
    await writeFile(resolvePath(empty), "");

    const missingPaths = await validateDownloadedPdfs([ok, empty, missing], resolvePath);

    expect(missingPaths).toHaveLength(2);
    expect(missingPaths).toContain(resolvePath(empty));
    expect(missingPaths).toContain(resolvePath(missing));
    expect(missingPaths).not.toContain(resolvePath(ok));
  });

  it("devuelve arreglo vacio si todos los PDFs existen y tienen contenido", async () => {
    dir = await mkdtemp(join(tmpdir(), "pdfv-"));
    const a = row("u1", "E1");
    const b = row("u2", "E2");
    await writeFile(resolvePath(a), "%PDF-1.4 a");
    await writeFile(resolvePath(b), "%PDF-1.4 b");

    const missingPaths = await validateDownloadedPdfs([a, b], resolvePath);
    expect(missingPaths).toEqual([]);
  });
});
