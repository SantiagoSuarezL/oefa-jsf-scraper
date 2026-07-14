import { describe, expect, it, vi } from "vitest";
import { Scraper, type ScraperDeps } from "../src/Scraper.js";
import { MissingViewStateError } from "../src/session/MissingViewStateError.js";
import { loadConfig } from "../src/config/index.js";
import type { ResolutionRow } from "../src/models/Resolution.js";
import type { Logger } from "../src/utils/Logger.js";
import type { SessionManager } from "../src/session/SessionManager.js";
import type { SearchService } from "../src/scraper/SearchService.js";
import type { PaginationService } from "../src/scraper/PaginationService.js";
import type { SanityChecker } from "../src/validation/SanityChecker.js";
import type { PdfDownloader } from "../src/scraper/PdfDownloader.js";
import type { PdfStorage } from "../src/storage/PdfStorage.js";
import type { JsonExporter } from "../src/storage/JsonExporter.js";
import type { SearchResult } from "../src/models/SearchResult.js";

function makeRows(count: number, start: number): ResolutionRow[] {
  return Array.from({ length: count }, (_, i) => {
    const n = start + i;
    return {
      numero: n,
      numeroExpediente: `EXP-${n}`,
      administrado: "EMPRESA",
      unidadFiscalizable: "UNIDAD",
      sector: "MINERÍA",
      numeroResolucion: `RES-${n}`,
      uuid: `uuid-${n}`,
      pdfButtonId: `btn-${n}`,
    };
  });
}

function makeDeps(overrides: Partial<ScraperDeps>): ScraperDeps {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;

  const config = loadConfig();

  const base: ScraperDeps = {
    config,
    logger,
    session: {
      init: vi.fn(),
      restart: vi.fn(),
      getViewState: vi.fn(() => "v"),
      updateViewState: vi.fn(),
    } as unknown as SessionManager,
    search: { search: vi.fn() } as unknown as SearchService,
    pagination: { fetchPage: vi.fn() } as unknown as PaginationService,
    sanity: { assertValid: vi.fn(), checkRows: vi.fn() } as unknown as SanityChecker,
    downloader: { downloadAll: vi.fn(async () => ({ ok: 1, failed: 0 })) } as unknown as PdfDownloader,
    storage: { buildPath: vi.fn((r: ResolutionRow) => `/tmp/${r.uuid}.pdf`) } as unknown as PdfStorage,
    exporter: { export: vi.fn() } as unknown as JsonExporter,
  };

  return { ...base, ...overrides };
}

describe("Scraper (orquestacion)", () => {
  it("usa config.rowsPerPage para paginar y se detiene en el total", async () => {
    process.env.OEFA_BASE_URL = "https://example.com/x.xhtml";
    process.env.OEFA_ROWS_PER_PAGE = "10";

    const searchResult: SearchResult = {
      rows: makeRows(10, 1),
      totalRecords: 25,
      viewState: "v",
    };
    const fetchPage = vi.fn(async (_f: unknown, first: number, rows: number) => {
      if (first === 10) return { rows: makeRows(10, 11) };
      if (first === 20) return { rows: makeRows(5, 21) };
      return { rows: [] };
    });

    const deps = makeDeps({
      search: { search: vi.fn(async () => searchResult) } as unknown as SearchService,
      pagination: { fetchPage } as unknown as PaginationService,
    });
    const scraper = new Scraper(deps);

    const summary = await scraper.run({});

    expect(fetchPage).toHaveBeenCalledWith({}, 10, 10);
    expect(fetchPage).toHaveBeenCalledWith({}, 20, 10);
    expect(summary.retrieved).toBe(25);
    expect(summary.paginationOk).toBe(true);
    expect(deps.exporter.export).toHaveBeenCalledTimes(1);
  });

  it("reinicia la sesion y reintenta la misma pagina ante MissingViewStateError", async () => {
    process.env.OEFA_BASE_URL = "https://example.com/x.xhtml";
    process.env.OEFA_ROWS_PER_PAGE = "10";

    const searchResult: SearchResult = {
      rows: makeRows(10, 1),
      totalRecords: 20,
      viewState: "v",
    };
    const fetchPage = vi.fn();
    fetchPage.mockRejectedValueOnce(new MissingViewStateError());
    fetchPage.mockResolvedValueOnce({ rows: makeRows(10, 11) });

    const restarted = vi.fn();
    const deps = makeDeps({
      search: { search: vi.fn(async () => searchResult) } as unknown as SearchService,
      pagination: { fetchPage } as unknown as PaginationService,
      session: {
        init: vi.fn(),
        restart: restarted,
        getViewState: vi.fn(() => "v"),
        updateViewState: vi.fn(),
      } as unknown as SessionManager,
    });
    const scraper = new Scraper(deps);

    const summary = await scraper.run({});

    expect(restarted).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(summary.retrieved).toBe(20);
    expect(summary.paginationOk).toBe(true);
  });

  it("no aborta todo si la descarga falla; continúa y exporta", async () => {
    process.env.OEFA_BASE_URL = "https://example.com/x.xhtml";
    process.env.OEFA_ROWS_PER_PAGE = "10";

    const searchResult: SearchResult = {
      rows: makeRows(10, 1),
      totalRecords: 10,
      viewState: "v",
    };
    const downloadAll = vi.fn(async () => {
      throw new Error("boom");
    });

    const deps = makeDeps({
      downloader: { downloadAll } as unknown as PdfDownloader,
    });
    // inyectar search result
    deps.search = {
      search: vi.fn(async () => searchResult),
    } as unknown as SearchService;

    const scraper = new Scraper(deps);
    const summary = await scraper.run({});

    expect(summary.searchOk).toBe(true);
    expect(summary.downloadedFailed).toBe(10);
    expect(deps.exporter.export).toHaveBeenCalledTimes(1);
  });
});
