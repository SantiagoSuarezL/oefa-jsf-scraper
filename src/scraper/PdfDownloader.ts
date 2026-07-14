import type { Logger } from "../utils/Logger.js";
import type { HttpClient } from "../client/HttpClient.js";
import { HttpResponseError as HttpResponseErrorClass } from "../client/HttpClient.js";
import type { SessionManager } from "../session/SessionManager.js";
import type { AppConfig } from "../config/index.js";
import {
  buildDownloadParams,
} from "../jsf/FormParamsBuilder.js";
import { PdfStorage } from "../storage/PdfStorage.js";
import { FailureRecorder } from "../storage/FailureRecorder.js";
import { mapWithConcurrency } from "../utils/Concurrency.js";
import { retry } from "../utils/Retry.js";
import { sleep } from "../utils/Sleep.js";
import type { ResolutionRow } from "../models/Resolution.js";

export class PdfDownloader {
  private readonly http: HttpClient;
  private readonly session: SessionManager;
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly storage: PdfStorage;
  private readonly failures: FailureRecorder;

  constructor(
    http: HttpClient,
    session: SessionManager,
    config: AppConfig,
    logger: Logger,
    storage: PdfStorage,
    failures: FailureRecorder
  ) {
    this.http = http;
    this.session = session;
    this.config = config;
    this.logger = logger;
    this.storage = storage;
    this.failures = failures;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof HttpResponseErrorClass) {
      return error.status === 429 || error.status >= 500;
    }
    return true;
  }

  async download(row: ResolutionRow): Promise<{ ok: boolean; path?: string }> {
    const viewState = this.session.getViewState();
    const params = buildDownloadParams(viewState, row.pdfButtonId, row.uuid);
    const finalPath = this.storage.buildPath(row);

    try {
      const savedPath = await retry<string>(async () => {
        const { status, stream } = await this.http.postFormStream(
          this.http.pageUrlPath,
          params
        );

        if (status === 403 || status === 404 || status === 429 || status >= 500) {
          stream.destroy();
          throw new HttpResponseErrorClass(status);
        }

        await this.storage.savePdf(stream, finalPath);
        return finalPath;
      }, {
        maxAttempts: this.config.retryMaxAttempts,
        baseDelayMs: this.config.retryBaseDelayMs,
        maxDelayMs: this.config.retryMaxDelayMs,
        jitterMs: this.config.retryJitterMs,
        shouldRetry: (error) => this.isRetryable(error),
        onRetry: ({ attempt, error, delayMs }) => {
          this.logger.warn(
            {
              uuid: row.uuid,
              attempt,
              delayMs,
              status: error instanceof HttpResponseErrorClass ? error.status : undefined,
            },
            "Reintentando descarga de PDF"
          );
        },
      });

      this.logger.info({ uuid: row.uuid, path: savedPath }, "PDF descargado");
      return { ok: true, path: savedPath };
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      const lastStatus =
        error instanceof HttpResponseErrorClass ? error.status : undefined;
      await this.failures.record(row, {
        attempts: this.config.retryMaxAttempts,
        lastStatus,
        lastError,
      });
      return { ok: false };
    }
  }

  async downloadAll(
    rows: readonly ResolutionRow[],
    signal?: AbortSignal
  ): Promise<{ ok: number; failed: number }> {
    let ok = 0;
    let failed = 0;

    const outcomes = await mapWithConcurrency(
      rows,
      async (row) => {
        const result = await this.download(row);
        if (result.ok) ok += 1;
        else failed += 1;

        if (this.config.downloadDelayMs > 0) {
          await sleep(this.config.downloadDelayMs, signal);
        }
        return result;
      },
      this.config.downloadConcurrency
    );

    void outcomes;
    this.logger.info({ ok, failed, total: rows.length }, "Descarga de PDFs finalizada");
    return { ok, failed };
  }
}
