import { test, expect } from "bun:test";
import { inferRoundLabels } from "./scrape-draws-page";

test("inferRoundLabels maps 32-draw round numbers", () => {
  const labels = inferRoundLabels([6, 5, 4, 3, 2]);
  expect(labels.get(6)).toBe("R32");
  expect(labels.get(5)).toBe("R16");
  expect(labels.get(4)).toBe("QF");
  expect(labels.get(3)).toBe("SF");
  expect(labels.get(2)).toBe("F");
});

test("inferRoundLabels maps 8-draw round numbers", () => {
  const labels = inferRoundLabels([4, 3, 2]);
  expect(labels.get(4)).toBe("QF");
  expect(labels.get(3)).toBe("SF");
  expect(labels.get(2)).toBe("F");
  expect(labels.size).toBe(3);
});
