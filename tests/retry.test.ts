import { describe, expect, it, vi } from "vitest";
import { retry, backoffDelayMs } from "../src/utils/Retry.js";
import { sleep } from "../src/utils/Sleep.js";

describe("backoffDelayMs", () => {
  it("crece exponencialmente y respeta el maximo", () => {
    expect(backoffDelayMs(1, 1000, 30000, 0)).toBe(1000);
    expect(backoffDelayMs(2, 1000, 30000, 0)).toBe(2000);
    expect(backoffDelayMs(3, 1000, 30000, 0)).toBe(4000);
  });

  it("no supera maxDelayMs", () => {
    expect(backoffDelayMs(10, 1000, 5000, 0)).toBe(5000);
  });

  it("aplica jitter dentro del rango", () => {
    const base = 1000;
    const jitter = 500;
    for (let i = 0; i < 20; i++) {
      const d = backoffDelayMs(1, base, 30000, jitter);
      expect(d).toBeGreaterThanOrEqual(base);
      expect(d).toBeLessThanOrEqual(base + jitter);
    }
  });
});

describe("retry", () => {
  it("devuelve el valor si el primer intento tiene exito", async () => {
    const fn = vi.fn(async () => 42);
    const result = await retry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("reintenta hasta tener exito y reporta los reintentos", async () => {
    let calls = 0;
    const onRetry = vi.fn();
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("fail");
      return "ok";
    });

    const result = await retry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 5,
      jitterMs: 0,
      onRetry,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("respeta shouldRetry y no reintenta si es false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("no-retry");
    });
    const onRetry = vi.fn();

    await expect(
      retry(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 5,
        jitterMs: 0,
        shouldRetry: () => false,
        onRetry,
      })
    ).rejects.toThrow("no-retry");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("lanza el ultimo error tras agotar los reintentos", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always");
    });

    await expect(
      retry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 5,
        jitterMs: 0,
      })
    ).rejects.toThrow("always");

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("se aborta si la senal lo indica", async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      throw new Error("x");
    });
    controller.abort();

    await expect(
      retry(fn, {
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        jitterMs: 0,
        signal: controller.signal,
      })
    ).rejects.toThrow("Aborted");

    expect(fn).not.toHaveBeenCalled();
  });

  it("el backoff realmente espera entre intentos", async () => {
    const fn = vi.fn(async () => {
      throw new Error("x");
    });
    const start = Date.now();
    await retry(fn, {
      maxAttempts: 3,
      baseDelayMs: 20,
      maxDelayMs: 100,
      jitterMs: 0,
    }).catch(() => undefined);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("sleep respeta la senal de abort", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toThrow("Aborted");
  });
});
