import { describe, it, expect } from "vitest";
import { SCRAPER_NAME, SCRAPER_VERSION } from "../src/index.js";

describe("scaffold", () => {
  it("expone nombre y version", () => {
    expect(SCRAPER_NAME).toBe("oefa-jsf-scraper");
    expect(SCRAPER_VERSION).toBe("0.1.0");
  });
});
