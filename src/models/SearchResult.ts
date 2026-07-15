import type { ResolutionRow } from "./Resolution.js";

export interface SearchResult {
  rows: ResolutionRow[];
  totalRecords: number | null;
  viewState: string;
  noPdfCount: number;
}
