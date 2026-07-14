import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { z } from "zod";
import {
  ResolutionSchema,
  type ResolutionRow,
} from "../models/Resolution.js";

const UUID_ONCLICK = /param_uuid'\s*:\s*'([^']+)'/;

export class HtmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HtmlParseError";
  }
}

function cellText($: cheerio.CheerioAPI, row: Element): string[] {
  return $(row)
    .find("td")
    .map((_i, td) => $(td).text().replace(/\s+/g, " ").trim())
    .get();
}

function extractUuid($: cheerio.CheerioAPI, row: Element): string {
  const onClick = $(row).find("td").last().find("[onclick]").attr("onclick") ?? "";
  const match = UUID_ONCLICK.exec(onClick);
  return match ? match[1]! : "";
}

export function parseDataTable(html: string): ResolutionRow[] {
  if (!html || !html.trim()) {
    throw new HtmlParseError("El HTML de la tabla esta vacio.");
  }

  const $ = cheerio.load(html);
  const rows = $('table[id$=":dt"] tbody tr[data-ri]');

  if (rows.length === 0) {
    return [];
  }

  const results: ResolutionRow[] = [];
  rows.each((index, row) => {
    const cells = cellText($, row);

    const raw = {
      numero: Number.parseInt(cells[0] ?? "", 10),
      numeroExpediente: cells[1] ?? "",
      administrado: cells[2] ?? "",
      unidadFiscalizable: cells[3] ?? "",
      sector: cells[4] ?? "",
      numeroResolucion: cells[5] ?? "",
      uuid: extractUuid($, row),
    };

    const parsed = ResolutionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HtmlParseError(
        `Fila ${index} (numero=${raw.numero}) invalida: ` +
          z.prettifyError(parsed.error)
      );
    }
    results.push(parsed.data);
  });

  return results;
}

export function extractTotalRecords(html: string): number | null {
  if (!html || !html.trim()) return null;
  const $ = cheerio.load(html);

  const current = $(".ui-paginator-current").first().text().trim();
  if (!current) return null;

  const match = /([\d.,]+)\s*\)?\s*$/.exec(current);
  if (!match) return null;

  const digits = match[1]!.replace(/[.,]/g, "");
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}
