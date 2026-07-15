import type { Logger } from "../utils/Logger.js";
import type { HttpClient } from "../client/HttpClient.js";
import type { SessionManager } from "../session/SessionManager.js";
import { MissingViewStateError } from "../session/MissingViewStateError.js";
import {
  buildPaginationParams,
  PG_LISTA_ID,
  PARTIAL_AJAX_HEADER,
} from "../jsf/FormParamsBuilder.js";
import { parsePartialResponse, findUpdate } from "../parser/XmlParser.js";
import { parseDataTable } from "../parser/HtmlParser.js";
import type { SearchFilters } from "../models/SearchFilters.js";
import type { PaginationPageResult } from "../models/PaginationPageResult.js";

const MAX_VIEWSTATE_RETRIES = 3;

export class PaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaginationError";
  }
}

export class PaginationService {
  constructor(
    private readonly http: HttpClient,
    private readonly session: SessionManager,
    private readonly logger: Logger
  ) {}

  async fetchPage(
    filters: SearchFilters,
    first: number,
    rows: number
  ): Promise<PaginationPageResult> {
    let retries = 0;

    while (true) {
      const viewState = this.session.getViewState();
      const params = buildPaginationParams(filters, viewState, first, rows);

      this.logger.info({ first, rows }, "Solicitando pagina");

      const xml = await this.http.postForm(this.http.pageUrlPath, params, {
        extraHeaders: PARTIAL_AJAX_HEADER,
      });

      const partial = parsePartialResponse(xml);

      const pgLista = findUpdate(partial.updates, PG_LISTA_ID);
      if (!pgLista) {
        throw new PaginationError(
          `La respuesta de paginacion no contiene el update "${PG_LISTA_ID}". ` +
            "El portal pudo haber cambiado la estructura o la pagina no existe."
        );
      }

      const parsed = parseDataTable(pgLista.content);
      const pageRows = parsed.rows;
      const noPdfCount = parsed.noPdfCount;

      if (!partial.viewState) {
        retries += 1;
        if (retries <= MAX_VIEWSTATE_RETRIES) {
          this.logger.warn(
            { attempt: retries, first },
            "ViewState no encontrado en respuesta de paginacion; reintentando misma pagina"
          );
          continue;
        }
        throw new MissingViewStateError();
      }

      this.session.updateViewState(partial.viewState);

      this.logger.info(
        { rows: pageRows.length, noPdfCount, first, viewStateUpdated: true },
        "Pagina obtenida"
      );

      return { rows: pageRows, noPdfCount };
    }
  }
}
