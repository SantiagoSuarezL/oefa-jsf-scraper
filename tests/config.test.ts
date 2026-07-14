import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config/index.js";
import * as dotenv from "dotenv";

vi.mock("dotenv", () => ({ config: vi.fn() }));

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("carga config válida con defaults", () => {
    process.env.OEFA_BASE_URL = "https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml";
    delete process.env.OEFA_OUTPUT_DIR;
    delete process.env.OEFA_DOWNLOAD_CONCURRENCY;

    const config = loadConfig();

    expect(config.baseUrl).toBe("https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml");
    expect(config.outputDir).toBe("./output");
    expect(config.downloadConcurrency).toBe(2);
    expect(config.logLevel).toBe("info");
  });

  it("sobrescribe defaults con vars de entorno", () => {
    process.env.OEFA_BASE_URL = "https://example.com/page.xhtml";
    process.env.OEFA_OUTPUT_DIR = "/custom/output";
    process.env.OEFA_ROWS_PER_PAGE = "25";
    process.env.OEFA_DOWNLOAD_CONCURRENCY = "4";
    process.env.OEFA_DOWNLOAD_DELAY_MS = "1000";
    process.env.OEFA_RETRY_MAX_ATTEMPTS = "3";
    process.env.OEFA_RETRY_BASE_DELAY_MS = "500";
    process.env.OEFA_RETRY_MAX_DELAY_MS = "10000";
    process.env.OEFA_HTTP_TIMEOUT_MS = "60000";
    process.env.OEFA_USER_AGENT = "CustomAgent/1.0";
    process.env.OEFA_LOG_LEVEL = "debug";

    const config = loadConfig();

    expect(config.rowsPerPage).toBe(25);
    expect(config.downloadConcurrency).toBe(4);
    expect(config.downloadDelayMs).toBe(1000);
    expect(config.retryMaxAttempts).toBe(3);
    expect(config.retryBaseDelayMs).toBe(500);
    expect(config.retryMaxDelayMs).toBe(10000);
    expect(config.httpTimeoutMs).toBe(60000);
    expect(config.userAgent).toBe("CustomAgent/1.0");
    expect(config.logLevel).toBe("debug");
  });

  it("falla si OEFA_BASE_URL falta", () => {
    delete process.env.OEFA_BASE_URL;
    expect(() => loadConfig()).toThrow();
  });

  it("falla si OEFA_BASE_URL no es URL válida", () => {
    process.env.OEFA_BASE_URL = "not-a-url";
    expect(() => loadConfig()).toThrow();
  });

  it("falla si concurrencia > 10", () => {
    process.env.OEFA_BASE_URL = "https://example.com/page.xhtml";
    process.env.OEFA_DOWNLOAD_CONCURRENCY = "11";
    expect(() => loadConfig()).toThrow();
  });

  it("falla si log level inválido", () => {
    process.env.OEFA_BASE_URL = "https://example.com/page.xhtml";
    process.env.OEFA_LOG_LEVEL = "verbose";
    expect(() => loadConfig()).toThrow();
  });

  it("coerce strings a number/boolean correctamente", () => {
    process.env.OEFA_BASE_URL = "https://example.com/page.xhtml";
    process.env.OEFA_ROWS_PER_PAGE = "10";
    process.env.OEFA_DOWNLOAD_DELAY_MS = "500";

    const config = loadConfig();

    expect(typeof config.rowsPerPage).toBe("number");
    expect(typeof config.downloadDelayMs).toBe("number");
  });
});