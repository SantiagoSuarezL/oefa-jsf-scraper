import { afterEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Buffer } from "node:buffer";

import { HttpClient } from "../src/client/HttpClient.js";
import { ViewStateManager } from "../src/session/ViewStateManager.js";
import { SessionManager } from "../src/session/SessionManager.js";
import { SearchService } from "../src/scraper/SearchService.js";
import { PaginationService } from "../src/scraper/PaginationService.js";
import { SanityChecker } from "../src/validation/SanityChecker.js";
import { PdfStorage } from "../src/storage/PdfStorage.js";
import { FailureRecorder } from "../src/storage/FailureRecorder.js";
import { PdfDownloader } from "../src/scraper/PdfDownloader.js";
import { JsonExporter } from "../src/storage/JsonExporter.js";
import { Scraper } from "../src/Scraper.js";
import { createLogger } from "../src/utils/Logger.js";
import { loadConfig } from "../src/config/index.js";

const PDF_BYTES = Buffer.from("%PDF-1.4 test content for e2e");

const PAGE_HTML = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8" /><title>OEFA - Consulta de Resoluciones</title></head>
<body>
<form id="listarDetalleInfraccionRAAForm" method="post"
      action="/repdig/consulta/consultaTfa.xhtml"
      enctype="application/x-www-form-urlencoded">
  <input type="hidden" name="listarDetalleInfraccionRAAForm" value="listarDetalleInfraccionRAAForm" />
  <input type="text" name="listarDetalleInfraccionRAAForm:txtNroexp" id="listarDetalleInfraccionRAAForm:txtNroexp" />
  <select name="listarDetalleInfraccionRAAForm:idsector" id="listarDetalleInfraccionRAAForm:idsector">
    <option value="">Todos</option>
    <option value="1">MINERÍA</option>
    <option value="2">ELECTRICIDAD</option>
    <option value="3">HIDROCARBUROS</option>
    <option value="8">PESQUERÍA</option>
    <option value="9">INDUSTRIA</option>
  </select>
  <input type="hidden" name="listarDetalleInfraccionRAAForm:j_idt21" />
  <input type="hidden" name="listarDetalleInfraccionRAAForm:j_idt25" />
  <input type="hidden" name="listarDetalleInfraccionRAAForm:j_idt34" />
  <button id="listarDetalleInfraccionRAAForm:btnBuscar" type="submit">Buscar</button>
  <input type="hidden" name="javax.faces.ViewState"
         value="-8765432109876543210:-9876543210state-init-e2e" />
</form>
</body>
</html>`;

const SEARCH_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<partial-response>
  <changes>
    <update id="listarDetalleInfraccionRAAForm:pgLista"><![CDATA[<div id="listarDetalleInfraccionRAAForm:pgLista">
  <table id="listarDetalleInfraccionRAAForm:dt" class="ui-datatable">
    <thead>
      <tr><th>Nro</th><th>Número de expediente</th><th>Administrado</th>
        <th>Unidad fiscalizable</th><th>Sector</th><th>Número de Resolución</th><th>Archivo</th></tr>
    </thead>
    <tbody class="ui-datatable-data">
      <tr data-ri="0" class="ui-widget-content">
        <td>1</td><td>EXP-2024-001</td><td>EMPRESA S.A.C.</td>
        <td>UNIDAD X</td><td>MINERÍA</td><td>RES-123</td>
        <td><button onclick="mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm'),{'listarDetalleInfraccionRAAForm:dt:0:j_idt63':'listarDetalleInfraccionRAAForm:dt:0:j_idt63','param_uuid':'62d415af-6462-4b14-9cab-a95717cc91f9'},'');">PDF</button></td>
      </tr>
      <tr data-ri="1" class="ui-widget-content">
        <td>2</td><td>EXP-2024-002</td><td>OTRA EMPRESA S.A.C.</td>
        <td>UNIDAD Y</td><td>HIDROCARBUROS</td><td>RES-124</td>
        <td><button onclick="mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm'),{'listarDetalleInfraccionRAAForm:dt:1:j_idt63':'listarDetalleInfraccionRAAForm:dt:1:j_idt63','param_uuid':'71e529b0-1234-4b14-9cab-a95717cc9999'},'');">PDF</button></td>
      </tr>
    </tbody>
  </table>
  <span class="ui-paginator-current">1 - 3 of 3</span>
</div>]]></update>
    <update id="j_id1:javax.faces.ViewState:0"><![CDATA[-8765432109876543210:state-after-search-e2e]]></update>
  </changes>
</partial-response>`;

const PAGE2_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<partial-response>
  <changes>
    <update id="listarDetalleInfraccionRAAForm:pgLista"><![CDATA[<div id="listarDetalleInfraccionRAAForm:pgLista">
  <table id="listarDetalleInfraccionRAAForm:dt" class="ui-datatable">
    <tbody class="ui-datatable-data">
      <tr data-ri="0" class="ui-widget-content">
        <td>3</td><td>EXP-2024-003</td><td>TERCERA EMPRESA S.R.L.</td>
        <td>UNIDAD Z</td><td>ELECTRICIDAD</td><td>RES-125</td>
        <td><button onclick="mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm'),{'listarDetalleInfraccionRAAForm:dt:0:j_idt63':'listarDetalleInfraccionRAAForm:dt:0:j_idt63','param_uuid':'0c31e2e0-4e20-4558-a82f-02de3426eba7'},'');">PDF</button></td>
      </tr>
    </tbody>
  </table>
  <span class="ui-paginator-current">(2 of 2)</span>
</div>]]></update>
    <update id="j_id1:javax.faces.ViewState:0"><![CDATA[-8765432109876543210:state-after-page2-e2e]]></update>
  </changes>
</partial-response>`;

function makeConfig(baseUrl: string, outDir: string) {
  process.env.OEFA_BASE_URL = baseUrl;
  process.env.OEFA_OUTPUT_DIR = outDir;
  process.env.OEFA_JSON_FILE = join(outDir, "resoluciones.json");
  process.env.OEFA_PDF_DIR = join(outDir, "pdfs");
  process.env.OEFA_ROWS_PER_PAGE = "10";
  process.env.OEFA_DOWNLOAD_CONCURRENCY = "2";
  process.env.OEFA_DOWNLOAD_DELAY_MS = "0";
  process.env.OEFA_RETRY_MAX_ATTEMPTS = "1";
  process.env.OEFA_RETRY_BASE_DELAY_MS = "1";
  process.env.OEFA_RETRY_MAX_DELAY_MS = "10";
  process.env.OEFA_RETRY_JITTER_MS = "0";
  process.env.OEFA_HTTP_TIMEOUT_MS = "5000";
  process.env.OEFA_USER_AGENT = "test-agent";
  process.env.OEFA_LOG_LEVEL = "warn";
  return loadConfig();
}

function createMockServer() {
  let page2Called = false;
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/repdig/consulta/consultaTfa.xhtml")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(PAGE_HTML);
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/repdig/consulta/consultaTfa.xhtml")) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (body.includes("javax.faces.source=listarDetalleInfraccionRAAForm%3AbtnBuscar")) {
          res.writeHead(200, { "Content-Type": "text/xml" });
          res.end(SEARCH_RESPONSE);
        } else if (body.includes("javax.faces.source=listarDetalleInfraccionRAAForm%3Adt")) {
          if (!page2Called) {
            page2Called = true;
            res.writeHead(200, { "Content-Type": "text/xml" });
            res.end(PAGE2_RESPONSE);
          } else {
            res.writeHead(200, { "Content-Type": "text/xml" });
            res.end(EMPTY_PAGE_RESPONSE);
          }
        } else if (body.includes("param_uuid")) {
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          res.end(PDF_BYTES);
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });
}

const EMPTY_PAGE_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<partial-response>
  <changes>
    <update id="listarDetalleInfraccionRAAForm:pgLista"><![CDATA[<div id="listarDetalleInfraccionRAAForm:pgLista">
  <table id="listarDetalleInfraccionRAAForm:dt" class="ui-datatable">
    <tbody class="ui-datatable-data"></tbody>
  </table>
  <span class="ui-paginator-current">(1 of 2)</span>
</div>]]></update>
    <update id="j_id1:javax.faces.ViewState:0"><![CDATA[-8765432109876543210:state-empty-page]]></update>
  </changes>
</partial-response>`;

async function makeScraper(server: http.Server, outDir: string) {
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/repdig/consulta/consultaTfa.xhtml`;
  const config = makeConfig(baseUrl, outDir);
  const logger = createLogger(config);

  const httpClient = new HttpClient(config, logger);
  const viewState = new ViewStateManager();
  const session = new SessionManager(httpClient, viewState, config, logger);

  const search = new SearchService(httpClient, session, logger);
  const pagination = new PaginationService(httpClient, session, logger);
  const sanity = new SanityChecker(logger);
  const storage = new PdfStorage(config.pdfDir);
  const failures = new FailureRecorder(config.outputDir, logger);
  const downloader = new PdfDownloader(httpClient, session, config, logger, storage, failures);
  const exporter = new JsonExporter(logger);

  const scraper = new Scraper({
    session,
    search,
    pagination,
    sanity,
    downloader,
    storage,
    exporter,
    config,
    logger,
  });

  return { scraper, config };
}

describe("E2E: flujo completo scraper", () => {
  let server: http.Server | undefined;
  let outDir: string | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (outDir) await rm(outDir, { recursive: true, force: true });
    server = undefined;
    outDir = undefined;
  });

  it("ejecuta busqueda, paginacion, descarga, validacion y exportacion JSON", async () => {
    server = createMockServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));

    outDir = await mkdtemp(join(tmpdir(), "e2e-"));
    const { scraper, config } = await makeScraper(server, outDir);

    const summary = await scraper.run({});

    expect(summary.searchOk).toBe(true);
    expect(summary.paginationOk).toBe(true);
    expect(summary.validationOk).toBe(true);
    expect(summary.downloadedOk).toBe(3);
    expect(summary.downloadedFailed).toBe(0);
    expect(summary.exported).toBe(true);
    expect(summary.retrieved).toBe(3);
    expect(summary.totalRecords).toBe(3);

    const jsonRaw = await readFile(config.jsonFile, "utf8");
    const json = JSON.parse(jsonRaw);
    expect(json.count).toBe(3);
    expect(json.resolutions).toHaveLength(3);
    expect(json.resolutions[0]?.uuid).toBe("62d415af-6462-4b14-9cab-a95717cc91f9");
    expect(json.resolutions[1]?.uuid).toBe("71e529b0-1234-4b14-9cab-a95717cc9999");
    expect(json.resolutions[2]?.uuid).toBe("0c31e2e0-4e20-4558-a82f-02de3426eba7");

    const pdfFiles = await readdir(config.pdfDir);
    expect(pdfFiles).toHaveLength(3);
    expect(pdfFiles.every((f) => f.endsWith(".pdf"))).toBe(true);

    const failedPath = join(config.outputDir, "failed-downloads.json");
    try {
      await readFile(failedPath, "utf8");
      throw new Error("failed-downloads.json no debe existir");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  });
});