import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonExporter } from "../src/storage/JsonExporter.js";
import { createLogger } from "../src/utils/Logger.js";
import { loadConfig } from "../src/config/index.js";
import type { ResolutionRow } from "../src/models/Resolution.js";

process.env.OEFA_BASE_URL = "https://example.com/x.xhtml";

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

describe("JsonExporter", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("escribe un JSON legible con metadatos y las resoluciones", async () => {
    dir = await mkdtemp(join(tmpdir(), "json-"));
    const path = join(dir, "resoluciones.json");
    const exporter = new JsonExporter(createLogger(loadConfig()));

    const rows = [row("u1", "E1"), row("u2", "E2")];
    await exporter.export(rows, path);

    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as {
      exportedAt: string;
      count: number;
      resolutions: ResolutionRow[];
    };

    expect(parsed.count).toBe(2);
    expect(parsed.resolutions).toHaveLength(2);
    expect(parsed.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.resolutions[0]?.uuid).toBe("u1");
  });
});
