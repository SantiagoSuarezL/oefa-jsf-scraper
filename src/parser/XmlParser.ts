import { XMLParser } from "fast-xml-parser";
import type { PartialResponseData, PartialUpdate } from "../models/PartialResponse.js";

const VIEW_STATE_ID_FRAGMENT = "javax.faces.ViewState";

const parser = new XMLParser({
  ignoreDeclaration: true,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  ignoreAttributes: false,
  trimValues: true,
});

interface RawUpdate {
  "@_id"?: string;
  "#text"?: string;
  "#cdata"?: string | string[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function updateContent(raw: RawUpdate): string {
  const cdata = raw["#cdata"];
  const cdataText = Array.isArray(cdata) ? cdata.join("") : cdata;
  const text = cdataText ?? raw["#text"] ?? "";
  return text.trim();
}

export function parsePartialResponse(xml: string): PartialResponseData {
  if (!xml || !xml.trim()) {
    throw new Error("parsePartialResponse: el XML esta vacio.");
  }

  const root = parser.parse(xml) as Record<string, unknown>;
  const partial = root["partial-response"] as Record<string, unknown> | undefined;
  if (!partial) {
    throw new Error(
      "parsePartialResponse: no se encontro <partial-response>. La respuesta no es AJAX de PrimeFaces."
    );
  }

  const changes = (partial["changes"] ?? {}) as Record<string, unknown>;
  const rawUpdates = asArray<RawUpdate>(changes["update"] as RawUpdate | RawUpdate[]);

  const updates: PartialUpdate[] = rawUpdates
    .filter((u) => typeof u["@_id"] === "string")
    .map((u) => ({ id: u["@_id"] as string, content: updateContent(u) }));

  return {
    updates,
    viewState: extractViewStateFromUpdates(updates),
  };
}

export function extractViewStateFromUpdates(updates: PartialUpdate[]): string | null {
  const match = updates.find((u) => u.id.includes(VIEW_STATE_ID_FRAGMENT));
  return match ? match.content : null;
}

export function findUpdate(updates: PartialUpdate[], id: string): PartialUpdate | undefined {
  return updates.find((u) => u.id === id);
}
