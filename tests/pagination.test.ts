import { afterEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { HttpClient } from "../src/client/HttpClient.js";
import { ViewStateManager } from "../src/session/ViewStateManager.js";
import { SessionManager } from "../src/session/SessionManager.js";
import { MissingViewStateError } from "../src/session/MissingViewStateError.js";
import { createLogger } from "../src/utils/Logger.js";
import { loadConfig } from "../src/config/index.js";
import {
  PaginationService,
  PaginationError,
} from "../src/scraper/PaginationService.js";

const PAGE_HTML = `<!DOCTYPE html>
<html><body>
<form id="listarDetalleInfraccionRAAForm">
  <input type="hidden" name="javax.faces.ViewState" value="vs-inicial-111" />
</form>
</body></html>`;

const PG_LISTA_HTML = `<div id="listarDetalleInfraccionRAAForm:pgLista">
  <table id="listarDetalleInfraccionRAAForm:dt">
    <tbody class="ui-datatable-data">
      <tr data-ri="0" class="ui-widget-content">
        <td>1</td>
        <td>EXP-2024-002</td>
        <td>EMPRESA B.S.A.</td>
        <td>UNIDAD Y</td>
        <td>HIDROCARBUROS</td>
        <td>RES-456</td>
        <td><button onclick="mojarra.jsfcljs(document.getElementById('x'),{'listarDetalleInfraccionRAAForm:dt:0:j_idt63':'listarDetalleInfraccionRAAForm:dt:0:j_idt63','param_uuid':'7f3c9b2e-1111-4a22-9cab-aa7717cc22f9'},'');">PDF</button></td>
      </tr>
    </tbody>
  </table>
  <span class="ui-paginator-current">(2 of 176)</span>
</div>`;

const PG_LISTA_EMPTY_HTML = `<div id="listarDetalleInfraccionRAAForm:pgLista">
  <table id="listarDetalleInfraccionRAAForm:dt"><tbody class="ui-datatable-data"></tbody></table>
</div>`;

function makePartialResponse(pgListaHtml: string, viewState: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<partial-response>
  <changes>
    <update id="listarDetalleInfraccionRAAForm:pgLista"><![CDATA[${pgListaHtml}]]></update>
    <update id="j_id1:javax.faces.ViewState:0"><![CDATA[${viewState}]]></update>
  </changes>
</partial-response>`;
}

function makePartialResponseNoPgLista(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<partial-response>
  <changes>
    <update id="otro"><![CDATA[<div></div>]]></update>
  </changes>
</partial-response>`;
}

function makePartialResponseNoViewState(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<partial-response>
  <changes>
    <update id="listarDetalleInfraccionRAAForm:pgLista"><![CDATA[${PG_LISTA_HTML}]]></update>
  </changes>
</partial-response>`;
}

function makeConfig(baseUrl: string) {
  process.env.OEFA_BASE_URL = baseUrl;
  return loadConfig();
}

async function makePaginationService(
  postHandler: http.RequestListener,
  initHandler: http.RequestListener = (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(PAGE_HTML);
  }
) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      initHandler(req, res);
    } else if (req.method === "POST") {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => postHandler(req, res, data));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));

  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}/repdig/consulta/consultaTfa.xhtml`;
  const config = makeConfig(baseUrl);

  const httpClient = new HttpClient(config, createLogger(config));
  const viewState = new ViewStateManager();
  const session = new SessionManager(httpClient, viewState, config, createLogger(config));
  await session.init();

  const pagination = new PaginationService(
    httpClient,
    session,
    createLogger(config)
  );

  return { server, pagination, session, viewState };
}

describe("PaginationService.fetchPage", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    server = undefined;
  });

  it("devuelve solo las filas de la pagina y actualiza el ViewState en SessionManager", async () => {
    const ctx = await makePaginationService((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(makePartialResponse(PG_LISTA_HTML, "vs-pag-222"));
    });
    server = ctx.server;

    const result = await ctx.pagination.fetchPage({}, 10, 10);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.numeroExpediente).toBe("EXP-2024-002");
    expect(result.rows[0]?.uuid).toBe("7f3c9b2e-1111-4a22-9cab-aa7717cc22f9");
    expect(ctx.viewState.get()).toBe("vs-pag-222");
  });

  it("maneja pagina vacia: rows=[] sin error", async () => {
    const ctx = await makePaginationService((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(makePartialResponse(PG_LISTA_EMPTY_HTML, "vs-pag-333"));
    });
    server = ctx.server;

    const result = await ctx.pagination.fetchPage({}, 20, 10);
    expect(result.rows).toEqual([]);
    expect(ctx.viewState.get()).toBe("vs-pag-333");
  });

  it("lanza PaginationError si la respuesta no contiene pgLista", async () => {
    const ctx = await makePaginationService((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(makePartialResponseNoPgLista());
    });
    server = ctx.server;

    await expect(ctx.pagination.fetchPage({}, 0, 10)).rejects.toThrow(PaginationError);
    await expect(ctx.pagination.fetchPage({}, 0, 10)).rejects.toThrow(/pgLista/);
  });

  it("lanza MissingViewStateError si la respuesta no trae ViewState", async () => {
    const ctx = await makePaginationService((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(makePartialResponseNoViewState());
    });
    server = ctx.server;

    await expect(ctx.pagination.fetchPage({}, 0, 10)).rejects.toThrow(MissingViewStateError);
    await expect(ctx.pagination.fetchPage({}, 0, 10)).rejects.toThrow(/ViewState/);
  });
});
