import { test, expect } from "bun:test";
import { generateScheduleGuid, parseResultScores } from "./store-schedule";

test("generateScheduleGuid sorts all player IDs", () => {
  const guid = generateScheduleGuid(23261, [208692, 98573], [254197, 213445]);
  expect(guid).toBe("schedule:23261:98573-208692-213445-254197");
});

test("generateScheduleGuid is order-independent", () => {
  const a = generateScheduleGuid(1, [3, 1], [4, 2]);
  const b = generateScheduleGuid(1, [4, 2], [1, 3]);
  expect(a).toBe(b);
});

test("parseResultScores parses standard scores", () => {
  expect(parseResultScores("6-4  6-3")).toEqual([
    { set_a: 6, set_b: 4, tie_a: -1, tie_b: -1 },
    { set_a: 6, set_b: 3, tie_a: -1, tie_b: -1 },
  ]);
});

test("parseResultScores parses three-set match", () => {
  expect(parseResultScores("6-4  4-6  7-5")).toEqual([
    { set_a: 6, set_b: 4, tie_a: -1, tie_b: -1 },
    { set_a: 4, set_b: 6, tie_a: -1, tie_b: -1 },
    { set_a: 7, set_b: 5, tie_a: -1, tie_b: -1 },
  ]);
});

test("parseResultScores returns empty for no result", () => {
  expect(parseResultScores("")).toEqual([]);
  expect(parseResultScores("vs")).toEqual([]);
});
