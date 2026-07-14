import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../src/utils/Logger.js";
import type { AppConfig } from "../src/config/index.js";

const makeConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  baseUrl: "https://example.com/page.xhtml",
  outputDir: "./output",
  jsonFile: "./output/resoluciones.json",
  pdfDir: "./output/pdfs",
  rowsPerPage: 10,
  downloadConcurrency: 2,
  downloadDelayMs: 500,
  retryMaxAttempts: 5,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 30000,
  httpTimeoutMs: 30000,
  userAgent: "TestAgent/1.0",
  logLevel: "info",
  ...overrides,
});

describe("createLogger", () => {
  it("crea logger con nivel por defecto info", () => {
    const logger = createLogger(makeConfig());
    expect(logger.level).toBe("info");
  });

  it("respeta logLevel debug", () => {
    const logger = createLogger(makeConfig({ logLevel: "debug" }));
    expect(logger.level).toBe("debug");
  });

  it("respeta logLevel warn", () => {
    const logger = createLogger(makeConfig({ logLevel: "warn" }));
    expect(logger.level).toBe("warn");
  });

  it("respeta logLevel error", () => {
    const logger = createLogger(makeConfig({ logLevel: "error" }));
    expect(logger.level).toBe("error");
  });

  it("loggea objetos con cookies sin lanzar error", () => {
    const logger = createLogger(makeConfig());
    const spy = vi.spyOn(logger, "info");

    logger.info({ cookie: "JSESSIONID=abc123", headers: { cookie: "secret=value" } }, "test");

    expect(spy).toHaveBeenCalled();
  });
});