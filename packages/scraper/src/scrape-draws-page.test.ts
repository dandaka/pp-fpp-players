import { test, expect } from "bun:test";

// scrapeDrawsPage requires a browser — tested via integration (scrape-upcoming-matches).
// This file is a placeholder for unit-testable helpers if added later.

test("scrape-draws-page module exports scrapeDrawsPage", async () => {
  const mod = await import("./scrape-draws-page");
  expect(typeof mod.scrapeDrawsPage).toBe("function");
});
