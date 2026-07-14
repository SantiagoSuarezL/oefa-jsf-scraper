export interface PartialUpdate {
  id: string;
  content: string;
}

export interface PartialResponseData {
  updates: PartialUpdate[];
  viewState: string | null;
}
