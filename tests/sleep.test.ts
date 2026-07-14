import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sleep } from "../src/utils/Sleep.js";

describe("sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resuelve después del tiempo especificado", async () => {
    const promise = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
  });

  it("rechaza si signal ya está abortado", async () => {
    const controller = new AbortController();
    controller.abort();

    try {
      await sleep(1000, controller.signal);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DOMException);
      expect((e as DOMException).name).toBe("AbortError");
    }
  });

  it("rechaza si signal se aborta durante el sleep", async () => {
    const controller = new AbortController();
    const promise = sleep(5000, controller.signal);

    controller.abort();

    try {
      await promise;
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DOMException);
      expect((e as DOMException).name).toBe("AbortError");
    }
  });

  it("no falla si signal no se aborta", async () => {
    const controller = new AbortController();
    const promise = sleep(100, controller.signal);

    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toBeUndefined();
  });
});