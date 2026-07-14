import type { SearchFilters } from "../models/SearchFilters.js";

export const FORM_ID = "listarDetalleInfraccionRAAForm";
export const BTN_BUSCAR = "listarDetalleInfraccionRAAForm:btnBuscar";
export const PG_LISTA_ID = "listarDetalleInfraccionRAAForm:pgLista";
export const DT_ID = "listarDetalleInfraccionRAAForm:dt";

export const PARTIAL_AJAX_HEADER = { "Faces-Request": "partial/ajax" };

export function buildBaseFormParams(
  filters: SearchFilters,
  viewState: string
): Record<string, string> {
  return {
    [FORM_ID]: FORM_ID,
    [`${FORM_ID}:txtNroexp`]: filters.numeroExpediente ?? "",
    [`${FORM_ID}:idsector`]: filters.sector ?? "",
    [`${FORM_ID}:j_idt21`]: "",
    [`${FORM_ID}:j_idt25`]: "",
    [`${FORM_ID}:j_idt34`]: "",
    "javax.faces.ViewState": viewState,
  };
}

export function buildSearchParams(
  filters: SearchFilters,
  viewState: string
): Record<string, string> {
  return {
    ...buildBaseFormParams(filters, viewState),
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": BTN_BUSCAR,
    "javax.faces.partial.execute": "@all",
    "javax.faces.partial.render": `${FORM_ID}:pgLista ${FORM_ID}:txtNroexp`,
    [BTN_BUSCAR]: BTN_BUSCAR,
  };
}

export function buildPaginationParams(
  filters: SearchFilters,
  viewState: string,
  first: number,
  rows: number
): Record<string, string> {
  return {
    ...buildBaseFormParams(filters, viewState),
    [`${DT_ID}_pagination`]: "true",
    [`${DT_ID}_first`]: String(first),
    [`${DT_ID}_rows`]: String(rows),
    [`${DT_ID}_skipChildren`]: "true",
    [`${DT_ID}_encodeFeature`]: "true",
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": DT_ID,
    "javax.faces.partial.execute": DT_ID,
    "javax.faces.partial.render": PG_LISTA_ID,
  };
}

export function buildDownloadParams(
  viewState: string,
  buttonId: string,
  uuid: string
): Record<string, string> {
  return {
    ...buildBaseFormParams({}, viewState),
    [buttonId]: buttonId,
    param_uuid: uuid,
  };
}
