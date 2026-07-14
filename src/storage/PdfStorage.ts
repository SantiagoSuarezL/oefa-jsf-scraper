import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { ResolutionRow } from "../models/Resolution.js";

export class EmptyPdfError extends Error {
  constructor(public readonly path: string) {
    super(`El PDF descargado esta vacio: ${path}`);
    this.name = "EmptyPdfError";
  }
}

export class PdfStorage {
  constructor(private readonly outDir: string) {}

  buildPath(row: ResolutionRow): string {
    const safeExpediente = row.numeroExpediente.replace(/[^\w.-]+/g, "_");
    return join(this.outDir, `${safeExpediente}_${row.uuid}.pdf`);
  }

  async savePdf(stream: Readable, finalPath: string): Promise<void> {
    await mkdir(dirname(finalPath), { recursive: true });

    const tmpPath = `${finalPath}.tmp`;

    try {
      await pipeline(stream, createWriteStream(tmpPath));

      const info = await stat(tmpPath);
      if (info.size === 0) {
        await unlink(tmpPath);
        throw new EmptyPdfError(finalPath);
      }

      await rename(tmpPath, finalPath);
    } catch (error) {
      if (error instanceof EmptyPdfError) throw error;
      try {
        await unlink(tmpPath);
      } catch {
        // archivo temporal ya no existe; ignorar
      }
      throw error;
    }
  }
}
