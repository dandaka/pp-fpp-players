import { test, expect } from "bun:test";
import { parseDate } from "./parse-date";

test("normalizes info_texts date with time suffix", () => {
  expect(parseDate("2021-12-26, 14:00", undefined)).toBe("2021-12-26");
});

test("returns info_texts date as-is when already YYYY-MM-DD", () => {
  expect(parseDate("2026-03-25", undefined)).toBe("2026-03-25");
});

test("parses date range from header_texts", () => {
  expect(parseDate(null, ["XII Open PSC", "Portugal, Lisboa", "25 - 29 March 2026"])).toBe("2026-03-25");
});

test("parses single date from header_texts", () => {
  expect(parseDate(null, ["Some Tournament", "Portugal", "17 March 2026"])).toBe("2026-03-17");
});

test("parses Portuguese month names", () => {
  expect(parseDate(null, ["Torneio", "25 - 29 março 2026"])).toBe("2026-03-25");
});

test("prefers info_texts over header_texts", () => {
  expect(parseDate("2026-03-25", ["Fallback", "1 - 5 June 2026"])).toBe("2026-03-25");
});

test("returns null when no date available", () => {
  expect(parseDate(null, undefined)).toBeNull();
  expect(parseDate(null, ["No date here", "Just text"])).toBeNull();
});

test("parses single-digit day", () => {
  expect(parseDate(null, ["Title", "3 - 5 January 2025"])).toBe("2025-01-03");
});
