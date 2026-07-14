import axios, {
  type AxiosInstance,
  type AxiosError,
  type AxiosRequestConfig,
  type GenericAbortSignal,
} from "axios";
import { type Readable } from "node:stream";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import type { AppConfig } from "../config/index.js";
import type { Logger } from "../utils/Logger.js";

export class HttpResponseError extends Error {
  constructor(
    public readonly status: number,
    message?: string
  ) {
    super(message ?? `Respuesta HTTP con estado ${status}`);
    this.name = "HttpResponseError";
  }
}

export interface HttpClientOptions {
  timeoutMs: number;
  userAgent: string;
  baseUrl: string;
}

export class HttpClient {
  private readonly client: AxiosInstance;
  private readonly jar: CookieJar;
  private readonly logger: Logger;
  private readonly pagePath: string;

  constructor(config: AppConfig, logger: Logger) {
    this.logger = logger;
    this.jar = new CookieJar();

    const target = new URL(config.baseUrl);
    this.pagePath = target.pathname + target.search;

    const instance = axios.create({
      baseURL: target.origin,
      timeout: config.httpTimeoutMs,
      jar: this.jar,
      withCredentials: true,
      maxRedirects: 5,
      headers: {
        "User-Agent": config.userAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });

    wrapper(instance);
    this.client = instance;

    this.logger.debug(
      { baseUrl: config.baseUrl, timeoutMs: config.httpTimeoutMs },
      "HttpClient inicializado"
    );
  }

  get cookieJar(): CookieJar {
    return this.jar;
  }

  get pageUrlPath(): string {
    return this.pagePath;
  }

  async getHtml(
    path: string,
    options?: { signal?: GenericAbortSignal }
  ): Promise<string> {
    this.logger.debug({ path }, "GET request");

    const config: AxiosRequestConfig = { responseType: "text" };
    if (options?.signal) config.signal = options.signal;

    const response = await this.client.get<string>(path, config);

    this.logger.debug(
      { path, status: response.status },
      "GET response recibida"
    );

    return response.data;
  }

  async postForm(
    path: string,
    params: Record<string, string>,
    options?: { signal?: GenericAbortSignal; extraHeaders?: Record<string, string> }
  ): Promise<string> {
    this.logger.debug(
      { path, fieldCount: Object.keys(params).length },
      "POST form request"
    );

    const body = new URLSearchParams(params);

    const config: AxiosRequestConfig = {
      responseType: "text",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...options?.extraHeaders,
      },
    };
    if (options?.signal) config.signal = options.signal;

    const response = await this.client.post<string>(path, body, config);

    this.logger.debug(
      { path, status: response.status },
      "POST form response recibida"
    );

    return response.data;
  }

  async postFormStream(
    path: string,
    params: Record<string, string>,
    options?: { signal?: GenericAbortSignal; extraHeaders?: Record<string, string> }
  ): Promise<{ status: number; stream: Readable }> {
    this.logger.debug(
      { path, fieldCount: Object.keys(params).length },
      "POST form stream request"
    );

    const body = new URLSearchParams(params);

    const config: AxiosRequestConfig = {
      responseType: "stream",
      validateStatus: () => true,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...options?.extraHeaders,
      },
    };
    if (options?.signal) config.signal = options.signal;

    const response = await this.client.post<Readable>(path, body, config);

    this.logger.debug(
      { path, status: response.status },
      "POST form stream response recibida"
    );

    return { status: response.status, stream: response.data };
  }

  isNetworkError(error: unknown): error is AxiosError {
    return axios.isAxiosError(error);
  }
}
