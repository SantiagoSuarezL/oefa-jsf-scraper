import { describe, expect, it } from "vitest";
import {
  buildBaseFormParams,
  buildSearchParams,
  buildPaginationParams,
  buildDownloadParams,
  FORM_ID,
  BTN_BUSCAR,
  DT_ID,
  PG_LISTA_ID,
} from "../../src/jsf/FormParamsBuilder.js";

const SAMPLE_UUID = "62d415af-6462-4b14-9cab-a95717cc91f9";
const SAMPLE_BUTTON_ID = "listarDetalleInfraccionRAAForm:dt:0:j_idt63";

describe("buildBaseFormParams", () => {
  it("incluye el formulario, filtros vacios y el ViewState", () => {
    const params = buildBaseFormParams({}, "vs-123");
    expect(params[FORM_ID]).toBe(FORM_ID);
    expect(params[`${FORM_ID}:txtNroexp`]).toBe("");
    expect(params[`${FORM_ID}:idsector`]).toBe("");
    expect(params[`${FORM_ID}:j_idt21`]).toBe("");
    expect(params[`${FORM_ID}:j_idt25`]).toBe("");
    expect(params[`${FORM_ID}:j_idt34`]).toBe("");
    expect(params["javax.faces.ViewState"]).toBe("vs-123");
  });

  it("propaga numeroExpediente y sector cuando se proveen", () => {
    const params = buildBaseFormParams(
      { numeroExpediente: "EXP-9", sector: "2" },
      "vs-123"
    );
    expect(params[`${FORM_ID}:txtNroexp`]).toBe("EXP-9");
    expect(params[`${FORM_ID}:idsector`]).toBe("2");
  });
});

describe("buildSearchParams", () => {
  it("agrega los parametros del boton Buscar y el source correcto", () => {
    const params = buildSearchParams({}, "vs-123");
    expect(params["javax.faces.partial.ajax"]).toBe("true");
    expect(params["javax.faces.source"]).toBe(BTN_BUSCAR);
    expect(params["javax.faces.partial.execute"]).toBe("@all");
    expect(params["javax.faces.partial.render"]).toBe(
      `${FORM_ID}:pgLista ${FORM_ID}:txtNroexp`
    );
    expect(params[BTN_BUSCAR]).toBe(BTN_BUSCAR);
  });

  it("conserva los parametros base del formulario", () => {
    const params = buildSearchParams({}, "vs-123");
    expect(params["javax.faces.ViewState"]).toBe("vs-123");
    expect(params[`${FORM_ID}:idsector`]).toBe("");
  });
});

describe("buildPaginationParams", () => {
  it("agrega los parametros de paginacion de PrimeFaces DataTable", () => {
    const params = buildPaginationParams({}, "vs-123", 20, 10);
    expect(params[`${DT_ID}_pagination`]).toBe("true");
    expect(params[`${DT_ID}_first`]).toBe("20");
    expect(params[`${DT_ID}_rows`]).toBe("10");
    expect(params[`${DT_ID}_skipChildren`]).toBe("true");
    expect(params[`${DT_ID}_encodeFeature`]).toBe("true");
  });

  it("usa el DataTable como source y renderiza pgLista", () => {
    const params = buildPaginationParams({}, "vs-123", 0, 10);
    expect(params["javax.faces.source"]).toBe(DT_ID);
    expect(params["javax.faces.partial.execute"]).toBe(DT_ID);
    expect(params["javax.faces.partial.render"]).toBe(PG_LISTA_ID);
    expect(params["javax.faces.partial.ajax"]).toBe("true");
  });

  it("conserva el ViewState y filtros base", () => {
    const params = buildPaginationParams(
      { sector: "8" },
      "vs-456",
      10,
      10
    );
    expect(params["javax.faces.ViewState"]).toBe("vs-456");
    expect(params[`${FORM_ID}:idsector`]).toBe("8");
  });
});

describe("buildDownloadParams", () => {
  it("construye un POST non-AJAX con el buttonId y el param_uuid", () => {
    const params = buildDownloadParams("vs-789", SAMPLE_BUTTON_ID, SAMPLE_UUID);

    expect(params[FORM_ID]).toBe(FORM_ID);
    expect(params["javax.faces.ViewState"]).toBe("vs-789");
    expect(params[SAMPLE_BUTTON_ID]).toBe(SAMPLE_BUTTON_ID);
    expect(params["param_uuid"]).toBe(SAMPLE_UUID);

    expect(params["javax.faces.partial.ajax"]).toBeUndefined();
    expect(params["javax.faces.source"]).toBeUndefined();
    expect(params["javax.faces.partial.render"]).toBeUndefined();
  });

  it("no propaga filtros de busqueda (la descarga no depende de sector/expediente)", () => {
    const params = buildDownloadParams("vs-789", SAMPLE_BUTTON_ID, SAMPLE_UUID);
    expect(params[`${FORM_ID}:txtNroexp`]).toBe("");
    expect(params[`${FORM_ID}:idsector`]).toBe("");
  });
});
