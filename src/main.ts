import { loadConfig } from "./config/index.js";
import { createLogger } from "./utils/Logger.js";
import { HttpClient } from "./client/HttpClient.js";
import { ViewStateManager } from "./session/ViewStateManager.js";
import { SessionManager } from "./session/SessionManager.js";
import { SearchService } from "./scraper/SearchService.js";
import { PaginationService } from "./scraper/PaginationService.js";
import { SanityChecker } from "./validation/SanityChecker.js";
import { PdfStorage } from "./storage/PdfStorage.js";
import { FailureRecorder } from "./storage/FailureRecorder.js";
import { PdfDownloader } from "./scraper/PdfDownloader.js";
import { JsonExporter } from "./storage/JsonExporter.js";
import { Scraper } from "./Scraper.js";
import type { SearchFilters, SectorId } from "./models/SearchFilters.js";

function parseFilters(argv: readonly string[]): SearchFilters {
  const filters: SearchFilters = {};
  for (const arg of argv) {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(arg);
    if (!match) continue;
    const key = match[1];
    const value = match[2] ?? "";
    if (key === "sector" && isSectorId(value)) {
      filters.sector = value;
    } else if (key === "expediente") {
      filters.numeroExpediente = value;
    }
  }
  return filters;
}

function isSectorId(value: string): value is SectorId {
  return ["", "1", "2", "3", "8", "9"].includes(value);
}

function parseLimit(argv: readonly string[]): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const eq = /^--limit=(\d+)$/.exec(arg);
    if (eq) return Number(eq[1]);
    if (arg === "--limit") {
      const value = argv[i + 1];
      if (value != null && /^\d+$/.test(value)) {
        return Number(value);
      }
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const baseConfig = loadConfig();
  const limit = parseLimit(process.argv.slice(2));
  const config =
    limit != null ? { ...baseConfig, maxDownloads: limit } : baseConfig;
  const logger = createLogger(config);

  const filters = parseFilters(process.argv.slice(2));
  logger.info(
    { sector: filters.sector ?? "(todos)", expediente: filters.numeroExpediente ?? "(ninguno)" },
    "Iniciando scraper"
  );

  const http = new HttpClient(config, logger);
  const viewState = new ViewStateManager();
  const session = new SessionManager(http, viewState, config, logger);

  const search = new SearchService(http, session, logger);
  const pagination = new PaginationService(http, session, logger);
  const sanity = new SanityChecker(logger);
  const storage = new PdfStorage(config.pdfDir);
  const failures = new FailureRecorder(config.outputDir, logger);
  const downloader = new PdfDownloader(http, session, config, logger, storage, failures);
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

  const summary = await scraper.run(filters);

  if (!summary.searchOk) {
    logger.error("El scraper no pudo completar la busqueda inicial");
    process.exitCode = 1;
  } else {
    logger.info({ summary }, "Scraper finalizado");
  }
}

main().catch((error: unknown) => {
  // Solo para fallos catastróficos de arranque (p. ej. config inválida).
  // Las fases individuales ya registran sus propios errores de forma granular.
  process.exitCode = 1;
  throw error;
});
