import { test, expect } from "bun:test";
import { parseDate, parseMatchDateTime } from "./parse-date";

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

// parseMatchDateTime tests

test("parseMatchDateTime: time + weekday + day + short month", () => {
  expect(parseMatchDateTime("22:30, Fri 27 Mar", "2025-03-25")).toBe("2025-03-27T22:30:00");
});

test("parseMatchDateTime: time + weekday + single-digit day", () => {
  expect(parseMatchDateTime("14:00, Sat 5 Apr", "2025-04-01")).toBe("2025-04-05T14:00:00");
});

test("parseMatchDateTime: already ISO with time", () => {
  expect(parseMatchDateTime("2021-12-26, 14:00", null)).toBe("2021-12-26T14:00:00");
});

test("parseMatchDateTime: already ISO without time", () => {
  expect(parseMatchDateTime("2021-12-26", null)).toBe("2021-12-26T00:00:00");
});

test("parseMatchDateTime: cross-year tournament Dec->Jan", () => {
  expect(parseMatchDateTime("10:00, Sat 4 Jan", "2024-12-20")).toBe("2025-01-04T10:00:00");
});

test("parseMatchDateTime: null input returns null", () => {
  expect(parseMatchDateTime(null, "2025-03-25")).toBeNull();
  expect(parseMatchDateTime("", "2025-03-25")).toBeNull();
});

test("parseMatchDateTime: no tournament date returns null for short format", () => {
  expect(parseMatchDateTime("22:30, Fri 27 Mar", null)).toBeNull();
});

test("parseMatchDateTime: weekday + day without time", () => {
  expect(parseMatchDateTime("Fri 27 Mar", "2025-03-25")).toBe("2025-03-27T00:00:00");
});

test("parseMatchDateTime: Nov match in Nov tournament", () => {
  expect(parseMatchDateTime("22:00, Fri 8 Nov", "2024-11-01")).toBe("2024-11-08T22:00:00");
});
