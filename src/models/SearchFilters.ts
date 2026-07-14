export type SectorId = "" | "1" | "2" | "3" | "8" | "9";

export interface SearchFilters {
  numeroExpediente?: string;
  sector?: SectorId;
}
