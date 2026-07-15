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
  removedDuplicates: number;
  noPdfCount: number;
}

export class Scraper {
  constructor(private readonly deps: ScraperDeps) {}

  async run(filters: SearchFilters = {}): Promise<ScraperSummary> {
    const searchResult = await this.runSearch(filters);
    if (!searchResult) {
      return this.emptySummary(false);
    }

    // Límite de filas a procesar end-to-end (extracción + descarga).
    // 0 = sin límite (entrega completa). >0 = modo prueba rápida.
    const rowLimit =
      this.deps.config.maxDownloads > 0
        ? this.deps.config.maxDownloads
        : Number.MAX_SAFE_INTEGER;
    const limited = rowLimit < Number.MAX_SAFE_INTEGER;

    let allRows: ResolutionRow[] = [...searchResult.rows];
    if (limited && allRows.length > rowLimit) {
      allRows = allRows.slice(0, rowLimit);
    }

    let totalNoPdf = searchResult.noPdfCount;

    const pagination = await this.runPagination(
      filters,
      searchResult.totalRecords,
      allRows,
      rowLimit
    );
    totalNoPdf += pagination.noPdfCount;

    // Deduplicar por UUID antes de descargar/exportar (elimina solapamientos
    // de borde y duplicados nativos del portal).
    const dedupe = this.dedupeByUuid(allRows);
    if (dedupe.removed > 0) {
      this.deps.logger.warn(
        { removed: dedupe.removed, before: allRows.length, after: dedupe.rows.length },
        "Filas duplicadas por UUID eliminadas antes de descargar/exportar"
      );
    }
    allRows = dedupe.rows;

    // En modo limitado no tiene sentido exigir retrieved == totalRecords.
    const validationOk = this.runValidation(
      allRows,
      limited ? null : searchResult.totalRecords,
      totalNoPdf,
      dedupe.removed
    );
    const download = await this.runDownload(allRows);
    const exported = await this.runExport(allRows, allRows);

    return {
      searchOk: true,
      totalRecords: searchResult.totalRecords,
      retrieved: allRows.length,
      paginationOk: pagination.ok,
      validationOk,
      downloadedOk: download.ok,
      downloadedFailed: download.failed,
      exported,
      removedDuplicates: dedupe.removed,
      noPdfCount: totalNoPdf,
    };
  }

  private dedupeByUuid(rows: readonly ResolutionRow[]): {
    rows: ResolutionRow[];
    removed: number;
  } {
    const seen = new Set<string>();
    const unique: ResolutionRow[] = [];
    for (const row of rows) {
      if (row.uuid) {
        if (seen.has(row.uuid)) continue;
        seen.add(row.uuid);
      }
      unique.push(row);
    }
    return { rows: unique, removed: rows.length - unique.length };
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
    allRows: ResolutionRow[],
    rowLimit: number
  ): Promise<{ ok: boolean; noPdfCount: number }> {
    const portalTotal = totalRecords ?? Number.MAX_SAFE_INTEGER;
    const stopAt = Math.min(portalTotal, rowLimit);
    const rowsPerPage = this.deps.config.rowsPerPage;
    const debug = this.deps.config.debugPagination;
    const seenUuids = new Map<string, number>();
    let first = rowsPerPage;
    let repeatedPages = 0;
    let breakAtFirst: number | null = null;
    let totalNoPdf = 0;

    try {
      while (allRows.length < stopAt) {
        try {
          const page = await this.deps.pagination.fetchPage(filters, first, rowsPerPage);
          totalNoPdf += page.noPdfCount;
          if (page.rows.length === 0) {
            breakAtFirst = first;
            this.deps.logger.warn(
              { first, retrieved: allRows.length, stopAt },
              "Paginacion: pagina vacia, se detiene el bucle (posible salto de registros)"
            );
            break;
          }

          const repeated = page.rows.filter((r) => r.uuid && seenUuids.has(r.uuid));
          const repeatedDetail = repeated.map((r) => ({
            uuid: r.uuid,
            firstSeenAt: r.uuid ? seenUuids.get(r.uuid) : undefined,
          }));
          for (const r of page.rows) {
            if (r.uuid) seenUuids.set(r.uuid, first);
          }
          if (repeated.length > 0) {
            repeatedPages += 1;
            this.deps.logger.warn(
              {
                first,
                repeatedCount: repeated.length,
                repeatedDetail,
              },
              "Paginacion: pagina con UUIDs ya vistos (posible pagina repetida)"
            );
          }

          if (debug) {
            const range = this.summarizePageRange(page.rows);
            this.deps.logger.info(
              {
                first,
                received: page.rows.length,
                noPdf: page.noPdfCount,
                firstExpediente: range?.firstExpediente,
                lastExpediente: range?.lastExpediente,
                firstUuid: range?.firstUuid,
                lastUuid: range?.lastUuid,
              },
              "Paginacion: rango de pagina"
            );
          }

          allRows.push(...page.rows);
          first += rowsPerPage;
        } catch (error) {
          this.deps.logger.error(
            { err: error, first, retrieved: allRows.length },
            "Fallo en la paginacion"
          );
          return { ok: false, noPdfCount: totalNoPdf };
        }
      }

      const uniqueUuids = seenUuids.size;
      const duplicateRows = allRows.length - uniqueUuids;
      this.deps.logger.info(
        {
          retrieved: allRows.length,
          uniqueUuids,
          duplicateRows,
          noPdfCount: totalNoPdf,
          repeatedPages,
          breakAtFirst,
          totalRecords,
          stopAt,
        },
        "Paginacion completada"
      );
      return { ok: true, noPdfCount: totalNoPdf };
    } catch (error) {
      this.deps.logger.error({ err: error, retrieved: allRows.length }, "Fallo en la paginacion");
      return { ok: false, noPdfCount: totalNoPdf };
    }
  }

  private summarizePageRange(rows: readonly ResolutionRow[]): {
    firstExpediente: string | undefined;
    lastExpediente: string | undefined;
    firstUuid: string | undefined;
    lastUuid: string | undefined;
  } | null {
    if (rows.length === 0) return null;
    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    return {
      firstExpediente: firstRow?.numeroExpediente,
      lastExpediente: lastRow?.numeroExpediente,
      firstUuid: firstRow?.uuid,
      lastUuid: lastRow?.uuid,
    };
  }

  private runValidation(
    rows: ResolutionRow[],
    totalRecords: number | null,
    noPdfCount: number,
    removedDuplicates = 0
  ): boolean {
    try {
      const report = this.deps.sanity.assertValid(
        rows,
        totalRecords,
        noPdfCount,
        removedDuplicates
      );
      for (const line of report.summary) {
        this.deps.logger.info({ summary: line }, line);
      }
      if (report.warnings.length > 0) {
        this.deps.logger.warn(
          { warnings: report.warnings },
          "Sanity check: advertencias (no bloqueantes)"
        );
      }
      this.deps.logger.info({ rows: rows.length }, "Sanity check exitoso");
      return true;
    } catch (error) {
      if (error instanceof SanityError) {
        for (const line of error.report.summary) {
          this.deps.logger.error({ summary: line }, line);
        }
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
        { ok: summary.ok, failed: summary.failed, attempted: rows.length },
        "Descarga de PDFs completada"
      );
      return summary;
    } catch (error) {
      this.deps.logger.error({ err: error }, "Fallo en la descarga de PDFs");
      return { ok: 0, failed: rows.length };
    }
  }

  private async runExport(
    rows: ResolutionRow[],
    downloadedRows: ResolutionRow[]
  ): Promise<boolean> {
    try {
      const missing = await validateDownloadedPdfs(downloadedRows, (row) => this.deps.storage.buildPath(row));
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
      removedDuplicates: 0,
      noPdfCount: 0,
    };
  }
}
