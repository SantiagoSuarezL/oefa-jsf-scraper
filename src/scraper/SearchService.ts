import type { Logger } from "../utils/Logger.js";
import type { HttpClient } from "../client/HttpClient.js";
import type { SessionManager } from "../session/SessionManager.js";
import { MissingViewStateError } from "../session/MissingViewStateError.js";
import {
  buildSearchParams,
  PG_LISTA_ID,
  PARTIAL_AJAX_HEADER,
} from "../jsf/FormParamsBuilder.js";
import { parsePartialResponse, findUpdate } from "../parser/XmlParser.js";
import { parseDataTable, extractTotalRecords } from "../parser/HtmlParser.js";
import type { SearchFilters } from "../models/SearchFilters.js";
import type { SearchResult } from "../models/SearchResult.js";

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

export class SearchService {
  constructor(
    private readonly http: HttpClient,
    private readonly session: SessionManager,
    private readonly logger: Logger
  ) {}

  async search(filters: SearchFilters = {}): Promise<SearchResult> {
    const viewState = this.session.getViewState();
    const params = buildSearchParams(filters, viewState);

    this.logger.info(
      { sector: filters.sector ?? "(todos)", hasExpediente: Boolean(filters.numeroExpediente) },
      "Iniciando busqueda"
    );

    const xml = await this.http.postForm(this.http.pageUrlPath, params, {
      extraHeaders: PARTIAL_AJAX_HEADER,
    });

    const partial = parsePartialResponse(xml);

    const pgLista = findUpdate(partial.updates, PG_LISTA_ID);
    if (!pgLista) {
      throw new SearchError(
        `La respuesta no contiene el update "${PG_LISTA_ID}". ` +
          "El portal pudo haber cambiado la estructura o la busqueda fallo."
      );
    }

    const parsed = parseDataTable(pgLista.content);
    const rows = parsed.rows;
    const noPdfCount = parsed.noPdfCount;
    const totalRecords = extractTotalRecords(pgLista.content);

    if (!partial.viewState) {
      throw new MissingViewStateError();
    }

    this.session.updateViewState(partial.viewState);

    this.logger.info(
      { rows: rows.length, noPdfCount, totalRecords, viewStateUpdated: true },
      "Busqueda completada"
    );

    return {
      rows,
      totalRecords,
      viewState: partial.viewState,
      noPdfCount,
    };
  }
}
