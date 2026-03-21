import { test, expect } from "bun:test";
import { parsePortugueseDate, parseCategory } from "./scrape-matches-page";

test("parsePortugueseDate parses tab text to ISO date", () => {
  expect(parsePortugueseDate("sáb, 21 mar", 2026)).toBe("2026-03-21");
  expect(parsePortugueseDate("qua, 18 mar", 2026)).toBe("2026-03-18");
  expect(parsePortugueseDate("dom, 1 jan", 2026)).toBe("2026-01-01");
});

test("parsePortugueseDate returns empty string for unparseable input", () => {
  expect(parsePortugueseDate("", 2026)).toBe("");
  expect(parsePortugueseDate("unknown", 2026)).toBe("");
});

test("parseCategory extracts category and subcategory", () => {
  expect(parseCategory("Masculinos 6 - M6-QP")).toEqual({ category: "M6", subcategory: "QP" });
  expect(parseCategory("Femininos 5 - F5-Quali")).toEqual({ category: "F5", subcategory: "Quali" });
  expect(parseCategory("Mistos 3 - MX3-QP")).toEqual({ category: "MX3", subcategory: "QP" });
});

test("parseCategory falls back for unexpected format", () => {
  expect(parseCategory("Unknown")).toEqual({ category: "Unknown", subcategory: "" });
});
