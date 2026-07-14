import { sleep } from "./Sleep.js";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
  signal?: AbortSignal;
}

function defaultShouldRetry(): boolean {
  return true;
}

export function backoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterMs: number
): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(maxDelayMs, exponential);
  const jitter = jitterMs > 0 ? Math.random() * jitterMs : 0;
  return Math.round(capped + jitter);
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitterMs = 0,
    shouldRetry = defaultShouldRetry,
    onRetry,
    signal,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLast = attempt >= maxAttempts;
      if (isLast || !shouldRetry(error, attempt)) {
        break;
      }

      const delayMs = backoffDelayMs(attempt, baseDelayMs, maxDelayMs, jitterMs);
      onRetry?.({ attempt, error, delayMs });
      await sleep(delayMs, signal);
    }
  }

  throw lastError;
}
