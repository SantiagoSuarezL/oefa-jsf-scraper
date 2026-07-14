import { config } from "dotenv";
import * as z from "zod";

config();

const envSchema = z.object({
  OEFA_BASE_URL: z.string().url(),
  OEFA_OUTPUT_DIR: z.string().default("./output"),
  OEFA_JSON_FILE: z.string().default("./output/resoluciones.json"),
  OEFA_PDF_DIR: z.string().default("./output/pdfs"),
  OEFA_ROWS_PER_PAGE: z.coerce.number().int().positive().default(10),
  OEFA_DOWNLOAD_CONCURRENCY: z.coerce.number().int().positive().max(10).default(2),
  OEFA_DOWNLOAD_DELAY_MS: z.coerce.number().int().min(0).default(500),
  OEFA_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OEFA_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(1000),
  OEFA_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(0).default(30000),
  OEFA_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  OEFA_USER_AGENT: z.string().min(1).default(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  ),
  OEFA_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface AppConfig {
  baseUrl: string;
  outputDir: string;
  jsonFile: string;
  pdfDir: string;
  rowsPerPage: number;
  downloadConcurrency: number;
  downloadDelayMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  httpTimeoutMs: number;
  userAgent: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.parse(process.env);
  return {
    baseUrl: parsed.OEFA_BASE_URL,
    outputDir: parsed.OEFA_OUTPUT_DIR,
    jsonFile: parsed.OEFA_JSON_FILE,
    pdfDir: parsed.OEFA_PDF_DIR,
    rowsPerPage: parsed.OEFA_ROWS_PER_PAGE,
    downloadConcurrency: parsed.OEFA_DOWNLOAD_CONCURRENCY,
    downloadDelayMs: parsed.OEFA_DOWNLOAD_DELAY_MS,
    retryMaxAttempts: parsed.OEFA_RETRY_MAX_ATTEMPTS,
    retryBaseDelayMs: parsed.OEFA_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: parsed.OEFA_RETRY_MAX_DELAY_MS,
    httpTimeoutMs: parsed.OEFA_HTTP_TIMEOUT_MS,
    userAgent: parsed.OEFA_USER_AGENT,
    logLevel: parsed.OEFA_LOG_LEVEL,
  };
}