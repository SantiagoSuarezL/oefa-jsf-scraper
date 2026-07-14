import type { Logger } from "./utils/Logger.js";
import type { SessionManager } from "./session/SessionManager.js";
import type { SearchService } from "./scraper/SearchService.js";
import type { PaginationService } from "./scraper/PaginationService.js";
import type { SanityChecker } from "./validation/SanityChecker.js";
import { SanityError } from "./validation/SanityChecker.js";
import type { PdfDownloader } from "./scraper/PdfDownloader.js";
import type { PdfStorage } from "./storage/PdfStorage.js";
import type { JsonExporter } from "./storage/JsonExporter.js";
import type { AppConfig } from "./config/index.js";
import type { SearchFilters } from "./models/SearchFilters.js";
import type { SearchResult } from "./models/SearchResult.js";
import type { ResolutionRow } from "./models/Resolution.js";
import { MissingViewStateError } from "./session/MissingViewStateError.js";
import { validateDownloadedPdfs } from "./validation/PdfValidator.js";

const MAX_VIEWSTATE_RECOVERIES = 3;

export interface ScraperDeps {
  session: SessionManager;
  search: SearchService;
  pagination: PaginationService;
  sanity: SanityChecker;
  downloader: PdfDownloader;
  storage: PdfStorage;
  exporter: JsonExporter;
  config: AppConfig;
  logger: Logger;
}

export interface ScraperSummary {
  searchOk: boolean;
  totalRecords: number | null;
  retrieved: number;
  paginationOk: boolean;
  validationOk: boolean;
  downloadedOk: number;
  downloadedFailed: number;
  exported: boolean;
}

export class Scraper {
  constructor(private readonly deps: ScraperDeps) {}

  async run(filters: SearchFilters = {}): Promise<ScraperSummary> {
    const searchResult = await this.runSearch(filters);
    if (!searchResult) {
      return this.emptySummary(false);
    }

    const allRows: ResolutionRow[] = [...searchResult.rows];
    const paginationOk = await this.runPagination(filters, searchResult.totalRecords, allRows);
    const validationOk = this.runValidation(allRows, searchResult.totalRecords);
    const download = await this.runDownload(allRows);
    const exported = await this.runExport(allRows);

    return {
      searchOk: true,
      totalRecords: searchResult.totalRecords,
      retrieved: allRows.length,
      paginationOk,
      validationOk,
      downloadedOk: download.ok,
      downloadedFailed: download.failed,
      exported,
    };
  }

  private async runSearch(filters: SearchFilters): Promise<SearchResult | null> {
    try {
      await this.deps.session.init();
      const result = await this.deps.search.search(filters);
      this.deps.logger.info(
        { totalRecords: result.totalRecords, firstPageRows: result.rows.length },
        "Busqueda inicial completada"
      );
      return result;
    } catch (error) {
      if (error instanceof MissingViewStateError) {
        this.deps.logger.warn("ViewState perdido en busqueda; reiniciando sesion");
        await this.deps.session.restart();
        try {
          const result = await this.deps.search.search(filters);
          this.deps.logger.info(
            { totalRecords: result.totalRecords },
            "Busqueda inicial completada tras reinicio"
          );
          return result;
        } catch (retryError) {
          this.deps.logger.error({ err: retryError }, "Busqueda fallida tras reinicio de sesion");
          return null;
        }
      }
      this.deps.logger.error({ err: error }, "Fallo en la busqueda inicial");
      return null;
    }
  }

  private async runPagination(
    filters: SearchFilters,
    totalRecords: number | null,
    allRows: ResolutionRow[]
  ): Promise<boolean> {
    const limit = totalRecords ?? Number.MAX_SAFE_INTEGER;
    const rowsPerPage = this.deps.config.rowsPerPage;
    let first = rowsPerPage;
    let recoveries = 0;

    try {
      while (allRows.length < limit) {
        try {
          const page = await this.deps.pagination.fetchPage(filters, first, rowsPerPage);
          if (page.rows.length === 0) break;

          allRows.push(...page.rows);
          first += rowsPerPage;
          recoveries = 0;
        } catch (error) {
          if (error instanceof MissingViewStateError && recoveries < MAX_VIEWSTATE_RECOVERIES) {
            recoveries += 1;
            this.deps.logger.warn(
              { attempt: recoveries, first },
              "ViewState perdido en paginacion; reiniciando sesion y reintentando pagina"
            );
            await this.deps.session.restart();
            continue;
          }
          this.deps.logger.error(
            { err: error, first, retrieved: allRows.length },
            "Fallo en la paginacion"
          );
          return false;
        }
      }

      this.deps.logger.info(
        { retrieved: allRows.length, totalRecords, limit },
        "Paginacion completada"
      );
      return true;
    } catch (error) {
      this.deps.logger.error({ err: error, retrieved: allRows.length }, "Fallo en la paginacion");
      return false;
    }
  }

  private runValidation(rows: ResolutionRow[], totalRecords: number | null): boolean {
    try {
      this.deps.sanity.assertValid(rows, totalRecords);
      this.deps.logger.info({ rows: rows.length }, "Sanity check exitoso");
      return true;
    } catch (error) {
      if (error instanceof SanityError) {
        this.deps.logger.error({ report: error.report }, "Sanity check fallido");
      } else {
        this.deps.logger.error({ err: error }, "Error en sanity check");
      }
      return false;
    }
  }

  private async runDownload(
    rows: ResolutionRow[]
  ): Promise<{ ok: number; failed: number }> {
    try {
      const summary = await this.deps.downloader.downloadAll(rows);
      this.deps.logger.info(
        { ok: summary.ok, failed: summary.failed },
        "Descarga de PDFs completada"
      );
      return summary;
    } catch (error) {
      this.deps.logger.error({ err: error }, "Fallo en la descarga de PDFs");
      return { ok: 0, failed: rows.length };
    }
  }

  private async runExport(rows: ResolutionRow[]): Promise<boolean> {
    try {
      const missing = await validateDownloadedPdfs(rows, (row) => this.deps.storage.buildPath(row));
      if (missing.length > 0) {
        this.deps.logger.warn({ count: missing.length }, "PDFs faltantes o vacios tras validacion");
      }
      await this.deps.exporter.export(rows, this.deps.config.jsonFile);
      this.deps.logger.info({ path: this.deps.config.jsonFile }, "Exportacion JSON completada");
      return true;
    } catch (error) {
      this.deps.logger.error({ err: error }, "Fallo en validacion/exportacion de PDFs");
      return false;
    }
  }

  private emptySummary(searchOk: boolean): ScraperSummary {
    return {
      searchOk,
      totalRecords: null,
      retrieved: 0,
      paginationOk: false,
      validationOk: false,
      downloadedOk: 0,
      downloadedFailed: 0,
      exported: false,
    };
  }
}
