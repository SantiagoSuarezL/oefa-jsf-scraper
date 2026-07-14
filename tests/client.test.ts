import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { HttpClient } from "../src/client/HttpClient.js";
import { createLogger } from "../src/utils/Logger.js";
import { loadConfig } from "../src/config/index.js";

const TEST_BASE_URL = "https://example.invalid/repdig/consulta/consultaTfa.xhtml";

function makeConfig(overrides: Partial<ReturnType<typeof loadConfig>>) {
  process.env.OEFA_BASE_URL = TEST_BASE_URL;
  return { ...loadConfig(), ...overrides };
}

function startServer(handler: http.RequestListener): Promise<http.Server> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("HttpClient", () => {
  let server: http.Server;
  let baseUrl: string;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  it("se construye con un CookieJar válido", () => {
    const config = makeConfig({ baseUrl: "http://127.0.0.1:1" });
    const client = new HttpClient(config, createLogger(config));
    expect(client.cookieJar).toBeDefined();
    expect(typeof client.cookieJar.setCookie).toBe("function");
  });

  it("GET devuelve el cuerpo HTML y conserva la cookie de sesión", async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Set-Cookie": "JSESSIONID=abc123; Path=/; HttpOnly",
      });
      res.end("<html><body>ok</body></html>");
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const config = makeConfig({ baseUrl });
    const client = new HttpClient(config, createLogger(config));
    const html = await client.getHtml("/");

    expect(html).toContain("ok");

    const cookies = await client.cookieJar.getCookies(baseUrl);
    const session = cookies.find((c) => c.key === "JSESSIONID");
    expect(session?.value).toBe("abc123");
  });

  it("POST form envía urlencoded y devuelve el cuerpo", async () => {
    let receivedBody = "";
    server = await startServer((req, res) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        receivedBody = data;
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end("<partial-response/>");
      });
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const config = makeConfig({ baseUrl });
    const client = new HttpClient(config, createLogger(config));
    const result = await client.postForm("/", {
      "javax.faces.partial.ajax": "true",
      "javax.faces.ViewState": "vs-1",
    });

    expect(result).toContain("partial-response");
    expect(receivedBody).toContain("javax.faces.ViewState=vs-1");
    expect(receivedBody).toContain("javax.faces.partial.ajax=true");
  });
});
