import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../utils/Logger.js";
import type { ResolutionRow } from "../models/Resolution.js";

export interface FailedDownload {
  uuid: string;
  pdfButtonId: string;
  numeroExpediente: string;
  attempts: number;
  lastStatus?: number | undefined;
  lastError: string;
  timestamp: string;
}

export interface FailureRecordInput {
  attempts: number;
  lastStatus?: number | undefined;
  lastError: string;
}

export class FailureRecorder {
  constructor(
    private readonly outDir: string,
    private readonly logger: Logger
  ) {}

  async record(row: ResolutionRow, info: FailureRecordInput): Promise<void> {
    const entry: FailedDownload = {
      uuid: row.uuid,
      pdfButtonId: row.pdfButtonId,
      numeroExpediente: row.numeroExpediente,
      attempts: info.attempts,
      lastStatus: info.lastStatus,
      lastError: info.lastError,
      timestamp: new Date().toISOString(),
    };

    const file = join(this.outDir, "failed-downloads.json");
    const line = JSON.stringify(entry);

    this.logger.warn(
      { uuid: row.uuid, lastStatus: info.lastStatus, lastError: info.lastError },
      "PDF fallido registrado"
    );

    await writeFile(file, line + "\n", { flag: "a" });
  }
}
