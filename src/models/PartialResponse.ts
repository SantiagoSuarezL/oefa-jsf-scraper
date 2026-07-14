export interface PartialUpdate {
  id: string;
  html: string;
}

export interface PartialResponseData {
  updates: PartialUpdate[];
  viewState: string;
}
