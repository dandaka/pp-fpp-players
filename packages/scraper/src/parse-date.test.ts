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

test("parses cross-month date range", () => {
  expect(parseDate(null, ["Torneio fim de ano", "13 January - 11 February 2024"])).toBe("2024-01-13");
});

test("parses cross-month range with different month lengths", () => {
  expect(parseDate(null, ["GCST II", "Santo Tirso", "30 April - 1 May 2022"])).toBe("2022-04-30");
});

test("parses cross-month range Feb to March", () => {
  expect(parseDate(null, ["Open Wilson", "Vendas Azeitão", "23 February - 2 March 2019"])).toBe("2019-02-23");
});

test("parses cross-month range May to June", () => {
  expect(parseDate(null, ["Campeonato Regional", "Machico", "31 May - 3 June 2018"])).toBe("2018-05-31");
});

test("parses long-span cross-year range", () => {
  expect(parseDate(null, ["1ª Taça da Liga Dunlop", "19 November 2022 - 31 March 2023"])).toBe("2022-11-19");
});

test("parses cross-month range with Portuguese months", () => {
  expect(parseDate(null, ["Torneio", "28 fevereiro - 2 março 2025"])).toBe("2025-02-28");
});
