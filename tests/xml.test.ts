import { describe, expect, it } from "vitest";
import {
  parsePartialResponse,
  extractViewStateFromUpdates,
  findUpdate,
} from "../src/parser/XmlParser.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<partial-response>
  <changes>
    <update id="listarDetalleInfraccionRAAForm:pgLista">
      <![CDATA[<div class="ui-datatable"><table><tr><td>EXP-001</td></tr></table></div>]]>
    </update>
    <update id="j_id1:javax.faces.ViewState:0">
      <![CDATA[937462819029384756:ugHt8s2kdj]]>
    </update>
    <eval><![CDATA[PrimeFaces.ab({...})]]></eval>
    <extension ln="primefaces" type="args">{"validationFailed":false}</extension>
  </changes>
</partial-response>`;

describe("parsePartialResponse", () => {
  it("lanza con XML vacio", () => {
    expect(() => parsePartialResponse("")).toThrow(/vacio/);
  });

  it("lanza si no es partial-response", () => {
    expect(() => parsePartialResponse("<html></html>")).toThrow(/partial-response/);
  });

  it("parsea updates ignorando eval/extension", () => {
    const result = parsePartialResponse(SAMPLE_XML);
    expect(result.updates).toHaveLength(2);
    expect(result.updates.map((u) => u.id)).toEqual([
      "listarDetalleInfraccionRAAForm:pgLista",
      "j_id1:javax.faces.ViewState:0",
    ]);
  });

  it("conserva el contenido HTML dentro del CDATA", () => {
    const result = parsePartialResponse(SAMPLE_XML);
    const pg = findUpdate(result.updates, "listarDetalleInfraccionRAAForm:pgLista");
    expect(pg?.content).toContain('<table><tr><td>EXP-001</td></tr></table>');
  });

  it("extrae el ViewState del update correspondiente", () => {
    const result = parsePartialResponse(SAMPLE_XML);
    expect(result.viewState).toBe("937462819029384756:ugHt8s2kdj");
  });

  it("funciona con un solo update (no array)", () => {
    const single = `<partial-response><changes>
      <update id="j_id1:javax.faces.ViewState:0"><![CDATA[VS-UNICO]]></update>
    </changes></partial-response>`;
    const result = parsePartialResponse(single);
    expect(result.updates).toHaveLength(1);
    expect(result.viewState).toBe("VS-UNICO");
  });

  it("devuelve viewState null si no esta presente", () => {
    const noVs = `<partial-response><changes>
      <update id="otro"><![CDATA[contenido]]></update>
    </changes></partial-response>`;
    const result = parsePartialResponse(noVs);
    expect(result.viewState).toBeNull();
  });

  it("extractViewStateFromUpdates es reutilizable de forma aislada", () => {
    const vs = extractViewStateFromUpdates([
      { id: "x", content: "a" },
      { id: "foo:javax.faces.ViewState:0", content: "ZZZ" },
    ]);
    expect(vs).toBe("ZZZ");
  });
});
