import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import {
  ResolutionSchema,
  type ResolutionRow,
} from "../models/Resolution.js";

const UUID_ONCLICK = /param_uuid'\s*:\s*'([^']+)'/;
const BUTTON_ID_ONCLICK = /'([^']+)'\s*:\s*'\1'/;

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

function extractPdfButtonId($: cheerio.CheerioAPI, row: Element): string {
  const onClick = $(row).find("td").last().find("[onclick]").attr("onclick") ?? "";
  const match = BUTTON_ID_ONCLICK.exec(onClick);
  return match ? match[1]! : "";
}

export interface ParseDataTableResult {
  rows: ResolutionRow[];
  noPdfCount: number;
}

export function parseDataTable(html: string): ParseDataTableResult {
  if (!html || !html.trim()) {
    throw new HtmlParseError("El HTML de la tabla esta vacio.");
  }

  // La respuesta de paginación devuelve HTML inválido: <span><tr>...</tr></span>
  // Cheerio elimina los <tr> porque no son válidos dentro de <span>.
  // Solución: detectar si hay <tr data-ri> sueltos y envolverlos en <table><tbody>.
  let processedHtml = html;
  if (html.includes('<tr data-ri=') && !html.includes('<tbody')) {
    processedHtml = `<table><tbody>${html}</tbody></table>`;
  }

  const $ = cheerio.load(processedHtml);
  // Primera página: filas dentro de tbody.ui-datatable-data
  // Páginas siguientes: filas <tr> directas (ahora envueltas en tbody válido)
  let rows = $('tbody.ui-datatable-data tr[data-ri]');
  if (rows.length === 0) {
    rows = $('tr[data-ri]');
  }
  if (rows.length === 0) {
    rows = $('tbody tr[data-ri], table tr[data-ri]');
  }

  if (rows.length === 0) {
    return { rows: [], noPdfCount: 0 };
  }

  const results: ResolutionRow[] = [];
  let parsed = 0;
  let noPdf = 0;
  let skipped = 0;
  rows.each((_index, row) => {
    const cells = cellText($, row);

    if (cells.length < 6) {
      skipped++;
      return;
    }

    const uuid = extractUuid($, row);
    const pdfButtonId = extractPdfButtonId($, row);

    // Fila con datos pero sin enlace de descarga (sin param_uuid): no descargable.
    // Se contabiliza aparte para poder reconciliar el total del portal.
    if (!uuid || !pdfButtonId) {
      noPdf++;
      return;
    }

    const raw = {
      numero: Number.parseInt(cells[0] ?? "", 10),
      numeroExpediente: cells[1] ?? "",
      administrado: cells[2] ?? "",
      unidadFiscalizable: cells[3] ?? "",
      sector: cells[4] ?? "",
      numeroResolucion: cells[5] ?? "",
      uuid,
      pdfButtonId,
    };

    const parsedResult = ResolutionSchema.safeParse(raw);
    if (!parsedResult.success) {
      skipped++;
      return;
    }
    results.push(parsedResult.data);
    parsed++;
  });

  return { rows: results, noPdfCount: noPdf };
}

export function extractTotalRecords(html: string): number | null {
  if (!html || !html.trim()) return null;
  const $ = cheerio.load(html);

  // 1. Buscar en .ui-paginator-current (texto visible tipo "1 - 10 de 1.753")
  let current = $(".ui-paginator-current").first().text().trim();
  if (current) {
    const match = /([\d.,]+)\s*\)?\s*$/.exec(current);
    if (match?.[1]) {
      const digits = match[1].replace(/[.,]/g, "");
      const value = Number.parseInt(digits, 10);
      if (Number.isFinite(value)) return value;
    }
  }

  // 2. Buscar rowCount en script de inicialización PrimeFaces
  const scriptText = $('script').text();
  const rowCountMatch = /rowCount\s*:\s*(\d+)/.exec(scriptText);
  if (rowCountMatch?.[1]) {
    return Number.parseInt(rowCountMatch[1], 10);
  }

  // 3. Buscar totalRecords en template del paginador
  const templateMatch = /totalRecords\s*:\s*(\d+)/.exec(scriptText);
  if (templateMatch?.[1]) {
    return Number.parseInt(templateMatch[1], 10);
  }

  return null;
}
