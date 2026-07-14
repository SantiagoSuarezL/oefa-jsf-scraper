import { afterEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { HttpClient } from "../src/client/HttpClient.js";
import { ViewStateManager } from "../src/session/ViewStateManager.js";
import { SessionManager } from "../src/session/SessionManager.js";
import { createLogger } from "../src/utils/Logger.js";
import { loadConfig } from "../src/config/index.js";
import { SearchService, SearchError } from "../src/scraper/SearchService.js";
import {
  buildSearchParams,
} from "../src/jsf/FormParamsBuilder.js";
import { MissingViewStateError } from "../src/session/MissingViewStateError.js";

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
        <td>EXP-2024-001</td>
        <td>EMPRESA S.A.C.</td>
        <td>UNIDAD X</td>
        <td>MINERÍA</td>
        <td>RES-123</td>
        <td><button onclick="mojarra.jsfcljs(document.getElementById('x'),{'listarDetalleInfraccionRAAForm:dt:0:j_idt63':'listarDetalleInfraccionRAAForm:dt:0:j_idt63','param_uuid':'62d415af-6462-4b14-9cab-a95717cc91f9'},'');">PDF</button></td>
      </tr>
    </tbody>
  </table>
  <span class="ui-paginator-current">(1 of 176)</span>
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

function startServer(handler: http.RequestListener): Promise<http.Server> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function makeSearchService(
  baseUrl: string,
  postHandler: http.RequestListener,
  initHandler: http.RequestListener = (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(PAGE_HTML);
  }
) {
  let server: http.Server;
  let lastPostBody = "";
  let postHeaders: http.IncomingHttpHeaders = {};

  server = await startServer((req, res) => {
    if (req.method === "GET") {
      initHandler(req, res);
    } else if (req.method === "POST") {
      postHeaders = req.headers;
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        lastPostBody = data;
        postHandler(req, res, data);
      });
    }
  });

  const addr = server.address() as AddressInfo;
  const baseUrlWithPort = `http://127.0.0.1:${addr.port}/repdig/consulta/consultaTfa.xhtml`;
  const config = makeConfig(baseUrlWithPort);

  const httpClient = new HttpClient(config, createLogger(config));
  const viewState = new ViewStateManager();
  const session = new SessionManager(httpClient, viewState, config, createLogger(config));
  await session.init();

  const search = new SearchService(httpClient, session, createLogger(config));

  return {
    server,
    search,
    session,
    viewState,
    getLastPostBody: () => lastPostBody,
    getPostHeaders: () => postHeaders,
  };
}

describe("buildSearchParams (pure)", () => {
  it("construye los params esperados sin filtros", () => {
    const params = buildSearchParams({}, "vs-current");
    expect(params["listarDetalleInfraccionRAAForm"]).toBe("listarDetalleInfraccionRAAForm");
    expect(params["listarDetalleInfraccionRAAForm:txtNroexp"]).toBe("");
    expect(params["listarDetalleInfraccionRAAForm:idsector"]).toBe("");
    expect(params["javax.faces.partial.ajax"]).toBe("true");
    expect(params["javax.faces.source"]).toBe("listarDetalleInfraccionRAAForm:btnBuscar");
    expect(params["javax.faces.partial.execute"]).toBe("@all");
    expect(params["javax.faces.partial.render"]).toBe(
      "listarDetalleInfraccionRAAForm:pgLista listarDetalleInfraccionRAAForm:txtNroexp"
    );
    expect(params["listarDetalleInfraccionRAAForm:btnBuscar"]).toBe(
      "listarDetalleInfraccionRAAForm:btnBuscar"
    );
    expect(params["javax.faces.ViewState"]).toBe("vs-current");
  });

  it("incluye numeroExpediente y sector cuando se proveen", () => {
    const params = buildSearchParams(
      { numeroExpediente: "EXP-123", sector: "1" },
      "vs-current"
    );
    expect(params["listarDetalleInfraccionRAAForm:txtNroexp"]).toBe("EXP-123");
    expect(params["listarDetalleInfraccionRAAForm:idsector"]).toBe("1");
  });
});

describe("SearchService.search", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    server = undefined;
  });

  it("devuelve filas, totalRecords y actualiza el ViewState en SessionManager", async () => {
    const ctx = await makeSearchService(
      "http://127.0.0.1:0/repdig/consulta/consultaTfa.xhtml",
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(makePartialResponse(PG_LISTA_HTML, "vs-nuevo-222"));
      }
    );
    server = ctx.server;

    const result = await ctx.search.search();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.numeroExpediente).toBe("EXP-2024-001");
    expect(result.rows[0]?.uuid).toBe("62d415af-6462-4b14-9cab-a95717cc91f9");
    expect(result.totalRecords).toBe(176);
    expect(result.viewState).toBe("vs-nuevo-222");
    expect(ctx.viewState.get()).toBe("vs-nuevo-222");
  });

  it("envia los parametros POST esperados al servidor", async () => {
    const ctx = await makeSearchService(
      "http://127.0.0.1:0/repdig/consulta/consultaTfa.xhtml",
      (_req, res, _body) => {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(makePartialResponse(PG_LISTA_HTML, "vs-nuevo-333"));
      }
    );
    server = ctx.server;

    await ctx.search.search({ numeroExpediente: "EXP-XYZ", sector: "3" });

    const body = ctx.getLastPostBody();
    expect(body).toContain("listarDetalleInfraccionRAAForm=listarDetalleInfraccionRAAForm");
    expect(body).toContain("listarDetalleInfraccionRAAForm%3AtxtNroexp=EXP-XYZ");
    expect(body).toContain("listarDetalleInfraccionRAAForm%3Aidsector=3");
    expect(body).toContain("javax.faces.partial.ajax=true");
    expect(body).toContain(
      "javax.faces.source=listarDetalleInfraccionRAAForm%3AbtnBuscar"
    );
    expect(body).toContain("javax.faces.ViewState=vs-inicial-111");
  });

  it("envia el header Faces-Request: partial/ajax", async () => {
    const ctx = await makeSearchService(
      "http://127.0.0.1:0/repdig/consulta/consultaTfa.xhtml",
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(makePartialResponse(PG_LISTA_HTML, "vs-x"));
      }
    );
    server = ctx.server;

    await ctx.search.search();
    expect(ctx.getPostHeaders()["faces-request"]).toBe("partial/ajax");
  });

  it("lanza SearchError si la respuesta no contiene pgLista", async () => {
    const ctx = await makeSearchService(
      "http://127.0.0.1:0/repdig/consulta/consultaTfa.xhtml",
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(makePartialResponseNoPgLista());
      }
    );
    server = ctx.server;

    await expect(ctx.search.search()).rejects.toThrow(SearchError);
    await expect(ctx.search.search()).rejects.toThrow(/pgLista/);
  });

  it("lanza MissingViewStateError si la respuesta no trae ViewState", async () => {
    const ctx = await makeSearchService(
      "http://127.0.0.1:0/repdig/consulta/consultaTfa.xhtml",
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(makePartialResponseNoViewState());
      }
    );
    server = ctx.server;

    await expect(ctx.search.search()).rejects.toThrow(MissingViewStateError);
    await expect(ctx.search.search()).rejects.toThrow(/ViewState/);
  });

  it("maneja tabla vacia: rows=[], totalRecords=null, sin error", async () => {
    const ctx = await makeSearchService(
      "http://127.0.0.1:0/repdig/consulta/consultaTfa.xhtml",
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(makePartialResponse(PG_LISTA_EMPTY_HTML, "vs-empty-444"));
      }
    );
    server = ctx.server;

    const result = await ctx.search.search();
    expect(result.rows).toEqual([]);
    expect(result.totalRecords).toBeNull();
    expect(ctx.viewState.get()).toBe("vs-empty-444");
  });
});
