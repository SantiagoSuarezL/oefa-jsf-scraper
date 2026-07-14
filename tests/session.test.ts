import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { ViewStateManager } from "../src/session/ViewStateManager.js";
import { SessionManager, extractViewState } from "../src/session/SessionManager.js";
import { HttpClient } from "../src/client/HttpClient.js";
import { createLogger } from "../src/utils/Logger.js";
import { loadConfig } from "../src/config/index.js";

function makeConfig(overrides: Partial<ReturnType<typeof loadConfig>>) {
  process.env.OEFA_BASE_URL =
    overrides.baseUrl ?? "https://example.invalid/repdig/consulta/consultaTfa.xhtml";
  return { ...loadConfig(), ...overrides };
}

function startServer(handler: http.RequestListener): Promise<http.Server> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const PAGE_HTML = `<!DOCTYPE html>
<html><body>
<form id="listarDetalleInfraccionRAAForm">
  <input type="hidden" name="javax.faces.ViewState" value="vs-inicial-987" />
</form>
</body></html>`;

describe("ViewStateManager", () => {
  it("lanza si se lee antes de inicializar", () => {
    const vs = new ViewStateManager();
    expect(() => vs.get()).toThrow(/aun no ha sido inicializada/);
    expect(vs.has()).toBe(false);
  });

  it("almacena, expone y resetea el ViewState", () => {
    const vs = new ViewStateManager();
    vs.set("abc123");
    expect(vs.get()).toBe("abc123");
    expect(vs.has()).toBe(true);
    vs.reset();
    expect(vs.has()).toBe(false);
  });

  it("rechaza un ViewState vacio", () => {
    const vs = new ViewStateManager();
    expect(() => vs.set("")).toThrow(/vacio/);
  });
});

describe("extractViewState", () => {
  it("extrae el valor del input javax.faces.ViewState", () => {
    expect(extractViewState(PAGE_HTML)).toBe("vs-inicial-987");
  });

  it("lanza si el input no existe", () => {
    expect(() => extractViewState("<html><body>sin viewstate</body></html>")).toThrow(
      /No se pudo extraer/
    );
  });
});

describe("SessionManager", () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  it("init() obtiene la pagina y almacena el ViewState", async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Set-Cookie": "JSESSIONID=ses-1; Path=/; HttpOnly",
      });
      res.end(PAGE_HTML);
    });
    const addr = server.address() as AddressInfo;
    const config = makeConfig({
      baseUrl: `http://127.0.0.1:${addr.port}/repdig/consulta/consultaTfa.xhtml`,
    });

    const httpClient = new HttpClient(config, createLogger(config));
    const viewState = new ViewStateManager();
    const session = new SessionManager(httpClient, viewState, config, createLogger(config));

    await session.init();

    expect(viewState.has()).toBe(true);
    expect(viewState.get()).toBe("vs-inicial-987");
  });

  it("expone getViewState/updateViewState como unica autoridad de escritura", async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(PAGE_HTML);
    });
    const addr = server.address() as AddressInfo;
    const config = makeConfig({
      baseUrl: `http://127.0.0.1:${addr.port}/repdig/consulta/consultaTfa.xhtml`,
    });

    const httpClient = new HttpClient(config, createLogger(config));
    const viewState = new ViewStateManager();
    const session = new SessionManager(httpClient, viewState, config, createLogger(config));

    await session.init();
    expect(session.getViewState()).toBe("vs-inicial-987");

    session.updateViewState("nuevo-vs-456");
    expect(viewState.get()).toBe("nuevo-vs-456");
    expect(session.getViewState()).toBe("nuevo-vs-456");
  });
});
