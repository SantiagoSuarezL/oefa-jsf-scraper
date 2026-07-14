import { afterEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpClient } from "../src/client/HttpClient.js";
import { ViewStateManager } from "../src/session/ViewStateManager.js";
import { SessionManager } from "../src/session/SessionManager.js";
import { createLogger } from "../src/utils/Logger.js";
import { loadConfig } from "../src/config/index.js";
import { PdfStorage } from "../src/storage/PdfStorage.js";
import { FailureRecorder } from "../src/storage/FailureRecorder.js";
import { PdfDownloader } from "../src/scraper/PdfDownloader.js";
import type { ResolutionRow } from "../src/models/Resolution.js";

const PAGE_HTML = `<!DOCTYPE html><html><body>
<form id="listarDetalleInfraccionRAAForm">
  <input type="hidden" name="javax.faces.ViewState" value="vs-inicial-111" />
</form></body></html>`;

const PDF_BYTES = Buffer.from("%PDF-1.4 contenido del documento");

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

async function makeDownloader(
  downloadHandler: http.RequestListener
): Promise<{
  server: http.Server;
  downloader: PdfDownloader;
  outDir: string;
}> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(PAGE_HTML);
    } else if (req.method === "POST") {
      downloadHandler(req, res);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));

  const addr = server.address() as AddressInfo;
  process.env.OEFA_BASE_URL = `http://127.0.0.1:${addr.port}/repdig/consulta/consultaTfa.xhtml`;
  const config = loadConfig();
  const outDir = await mkdtemp(join(tmpdir(), "dl-"));

  const httpClient = new HttpClient(config, createLogger(config));
  const viewState = new ViewStateManager();
  const session = new SessionManager(httpClient, viewState, config, createLogger(config));
  await session.init();

  const storage = new PdfStorage(outDir);
  const failures = new FailureRecorder(outDir, createLogger(config));

  const downloader = new PdfDownloader(
    httpClient,
    session,
    config,
    createLogger(config),
    storage,
    failures
  );

  return { server, downloader, outDir };
}

describe("PdfDownloader", () => {
  let server: http.Server | undefined;
  let outDir: string | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (outDir) await rm(outDir, { recursive: true, force: true });
    server = undefined;
    outDir = undefined;
  });

  it("reintenta en 429 y finalmente guarda el PDF", async () => {
    let calls = 0;
    const ctx = await makeDownloader((_req, res) => {
      calls += 1;
      if (calls === 1) {
        res.writeHead(429);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(PDF_BYTES);
    });
    server = ctx.server;
    outDir = ctx.outDir;

    const result = await ctx.downloader.download(makeRow());

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);

    const files = await readdir(outDir);
    expect(files.some((f) => f.endsWith(".pdf"))).toBe(true);
    expect(files.some((f) => f.endsWith("failed-downloads.json"))).toBe(false);
  });

  it("no reintenta en 404 y registra el fallo con contexto", async () => {
    const ctx = await makeDownloader((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    server = ctx.server;
    outDir = ctx.outDir;

    const row = makeRow();
    const result = await ctx.downloader.download(row);

    expect(result.ok).toBe(false);

    const files = await readdir(outDir);
    expect(files.some((f) => f.endsWith(".pdf"))).toBe(false);
    expect(files.some((f) => f.endsWith("failed-downloads.json"))).toBe(true);

    const raw = await readFile(join(outDir, "failed-downloads.json"), "utf8");
    const entry = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(entry.uuid).toBe(row.uuid);
    expect(entry.pdfButtonId).toBe(row.pdfButtonId);
    expect(entry.numeroExpediente).toBe(row.numeroExpediente);
    expect(entry.attempts).toBe(5);
    expect(entry.lastStatus).toBe(404);
    expect(typeof entry.lastError).toBe("string");
    expect(typeof entry.timestamp).toBe("string");
  });

  it("descarga multiples filas con concurrencia limitada", async () => {
    const ctx = await makeDownloader((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(PDF_BYTES);
    });
    server = ctx.server;
    outDir = ctx.outDir;

    const rows = [
      makeRow(),
      makeRow({
        numeroExpediente: "EXP-2024-002",
        uuid: "71e529b0-1234-4b14-9cab-a95717cc9999",
        pdfButtonId: "listarDetalleInfraccionRAAForm:dt:1:j_idt63",
      }),
    ];
    const summary = await ctx.downloader.downloadAll(rows);

    expect(summary.ok).toBe(2);
    expect(summary.failed).toBe(0);

    const files = await readdir(outDir);
    expect(files.filter((f) => f.endsWith(".pdf")).length).toBe(2);
  });
});
