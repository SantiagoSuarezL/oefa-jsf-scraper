import { stat } from "node:fs/promises";
import type { ResolutionRow } from "../models/Resolution.js";

export async function validateDownloadedPdfs(
  rows: readonly ResolutionRow[],
  resolvePath: (row: ResolutionRow) => string
): Promise<string[]> {
  const missing: string[] = [];

  for (const row of rows) {
    const path = resolvePath(row);
    try {
      const info = await stat(path);
      if (info.size === 0) {
        missing.push(path);
      }
    } catch {
      missing.push(path);
    }
  }

  return missing;
}
