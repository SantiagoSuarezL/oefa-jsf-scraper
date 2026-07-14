import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "../utils/Logger.js";
import type { ResolutionRow } from "../models/Resolution.js";

export class JsonExporter {
  constructor(private readonly logger: Logger) {}

  async export(rows: readonly ResolutionRow[], path: string): Promise<void> {
    const payload = {
      exportedAt: new Date().toISOString(),
      count: rows.length,
      resolutions: rows,
    };

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(payload, null, 2), "utf8");

    this.logger.info({ path, count: rows.length }, "Resoluciones exportadas a JSON");
  }
}
