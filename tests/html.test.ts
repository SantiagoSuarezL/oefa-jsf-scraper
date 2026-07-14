import { describe, expect, it } from "vitest";
import { parseDataTable, extractTotalRecords, HtmlParseError } from "../src/parser/HtmlParser.js";

const DATA_TABLE_HTML = `<table id="listarDetalleInfraccionRAAForm:dt" class="ui-datatable">
  <thead><tr><th>Nro</th><th>Número de expediente</th><th>Administrado</th>
    <th>Unidad fiscalizable</th><th>Sector</th><th>Número de Resolución</th><th>Archivo</th></tr></thead>
  <tbody class="ui-datatable-data">
    <tr data-ri="0" class="ui-widget-content">
      <td>1</td>
      <td>EXP-2024-001</td>
      <td>EMPRESA S.A.C.</td>
      <td>UNIDAD X</td>
      <td>MINERÍA</td>
      <td>RES-123</td>
      <td><button onclick="mojarra.jsfcljs(document.getElementById('x'),{'listarDetalleInfraccionRAAForm:dt:0:j_idt63':'listarDetalleInfraccionRAAForm:dt:0:j_idt63','param_uuid':'62d415af-6462-4b14-9cab-a95717cc91f9'},'');">PDF</button></td>
    </tr>
    <tr data-ri="1" class="ui-widget-content">
      <td>2</td>
      <td>EXP-2024-002</td>
      <td>OTRA EMPRESA</td>
      <td>UNIDAD Y</td>
      <td>HIDROCARBUROS</td>
      <td>RES-124</td>
      <td><button onclick="mojarra.jsfcljs(document.getElementById('x'),{'listarDetalleInfraccionRAAForm:dt:1:j_idt63':'listarDetalleInfraccionRAAForm:dt:1:j_idt63','param_uuid':'71e529b0-1234-4b14-9cab-a95717cc9999'},'');">PDF</button></td>
    </tr>
  </tbody>
</table>
<span class="ui-paginator-current">(1 of 176)</span>`;

describe("parseDataTable", () => {
  it("lanza con HTML vacio", () => {
    expect(() => parseDataTable("")).toThrow(HtmlParseError);
  });

  it("devuelve arreglo vacio si no hay filas", () => {
    expect(parseDataTable("<div>sin tabla</div>")).toEqual([]);
  });

  it("extrae y valida las filas con su uuid", () => {
    const rows = parseDataTable(DATA_TABLE_HTML);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      numero: 1,
      numeroExpediente: "EXP-2024-001",
      administrado: "EMPRESA S.A.C.",
      unidadFiscalizable: "UNIDAD X",
      sector: "MINERÍA",
      numeroResolucion: "RES-123",
      uuid: "62d415af-6462-4b14-9cab-a95717cc91f9",
    });
    expect(rows[1]?.uuid).toBe("71e529b0-1234-4b14-9cab-a95717cc9999");
  });

  it("lanza si una fila no cumple el esquema (uuid invalido)", () => {
    const broken = DATA_TABLE_HTML.replace(
      "62d415af-6462-4b14-9cab-a95717cc91f9",
      "NO-ES-UUID"
    );
    expect(() => parseDataTable(broken)).toThrow(/invalida/);
  });
});

describe("extractTotalRecords", () => {
  it("extrae el total del paginador", () => {
    expect(extractTotalRecords(DATA_TABLE_HTML)).toBe(176);
  });

  it("retorna null si no hay paginador", () => {
    expect(extractTotalRecords("<table></table>")).toBeNull();
  });

  it("maneja separador de miles (1.753)", () => {
    const html = `<span class="ui-paginator-current">1 - 10 de 1.753</span>`;
    expect(extractTotalRecords(html)).toBe(1753);
  });
});
