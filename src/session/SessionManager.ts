import * as cheerio from "cheerio";
import type { AppConfig } from "../config/index.js";
import type { Logger } from "../utils/Logger.js";
import type { HttpClient } from "../client/HttpClient.js";
import { ViewStateManager } from "./ViewStateManager.js";

export class SessionManager {
  private readonly http: HttpClient;
  private readonly viewState: ViewStateManager;
  private readonly config: AppConfig;
  private readonly logger: Logger;

  constructor(
    http: HttpClient,
    viewState: ViewStateManager,
    config: AppConfig,
    logger: Logger
  ) {
    this.http = http;
    this.viewState = viewState;
    this.config = config;
    this.logger = logger;
  }

  async init(): Promise<void> {
    this.logger.info(
      { url: this.config.baseUrl },
      "Iniciando sesion: GET pagina principal"
    );

    const html = await this.http.getHtml(this.http.pageUrlPath);
    const viewState = extractViewState(html);

    this.updateViewState(viewState);

    this.logger.info("Sesion iniciada: ViewState extraido correctamente");
  }

  getViewState(): string {
    return this.viewState.get();
  }

  updateViewState(value: string): void {
    this.viewState.set(value);
  }

  async restart(): Promise<void> {
    this.logger.warn("Reiniciando sesion (ViewState invalido)");
    this.viewState.reset();
    await this.init();
  }
}

export function extractViewState(html: string): string {
  const $ = cheerio.load(html);
  const value = $('input[name="javax.faces.ViewState"]').attr("value");

  if (!value) {
    throw new Error(
      "No se pudo extraer javax.faces.ViewState del HTML inicial. " +
        "El portal puede haber cambiado su estructura o la respuesta no es la esperada."
    );
  }

  return value;
}
