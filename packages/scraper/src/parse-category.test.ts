import { test, expect, describe } from "bun:test";
import { parseCategoryCode } from "./parse-category";

describe("parseCategoryCode", () => {
  test("Masculinos level", () => {
    expect(parseCategoryCode("Masculinos 5")).toBe("M5");
    expect(parseCategoryCode("Masculinos 1")).toBe("M1");
    expect(parseCategoryCode("Masculinos 6")).toBe("M6");
  });

  test("Femininos level", () => {
    expect(parseCategoryCode("Femininos 4")).toBe("F4");
    expect(parseCategoryCode("Femininos 1")).toBe("F1");
  });

  test("Mixed level", () => {
    expect(parseCategoryCode("Mix 3")).toBe("MX3");
    expect(parseCategoryCode("Mistos 3")).toBe("MX3");
  });

  test("Veterans masculinos", () => {
    expect(parseCategoryCode("Masculinos Veteranos +45")).toBe("M+45");
    expect(parseCategoryCode("Masculinos +50")).toBe("M+50");
  });

  test("Veterans femininos", () => {
    expect(parseCategoryCode("Femininos +50")).toBe("F+50");
    expect(parseCategoryCode("Femininos Veteranos +45")).toBe("F+45");
  });

  test("Youth masculinos", () => {
    expect(parseCategoryCode("Masculinos Sub-14")).toBe("M-SUB14");
    expect(parseCategoryCode("Masculinos Sub-12")).toBe("M-SUB12");
  });

  test("Youth femininos", () => {
    expect(parseCategoryCode("Femininos Sub-14")).toBe("F-SUB14");
    expect(parseCategoryCode("Femininos Sub-12")).toBe("F-SUB12");
  });

  test("Playwright category codes passthrough", () => {
    expect(parseCategoryCode("M5")).toBe("M5");
    expect(parseCategoryCode("F4")).toBe("F4");
    expect(parseCategoryCode("MX3")).toBe("MX3");
  });

  test("Playwright with suffix", () => {
    expect(parseCategoryCode("M5-Quali")).toBe("M5");
    expect(parseCategoryCode("M6-QP")).toBe("M6");
    expect(parseCategoryCode("Quadro Principal M5")).toBe("M5");
    expect(parseCategoryCode("Qualificação F4")).toBe("F4");
  });

  test("unknown returns UNKNOWN", () => {
    expect(parseCategoryCode("")).toBe("UNKNOWN");
    expect(parseCategoryCode("Some Random Text")).toBe("UNKNOWN");
  });
});
