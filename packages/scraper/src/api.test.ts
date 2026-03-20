import { test, expect } from "bun:test";
import { getPlayerProfile, getPlayerMatches } from "./api";

test("getPlayerProfile returns valid data", async () => {
  const profile = await getPlayerProfile(432061);
  expect(profile.status).toBe(1);
  expect(profile.player_name).toBeTruthy();
});

test("getPlayerMatches returns array", async () => {
  const matches = await getPlayerMatches(432061, 2026);
  expect(Array.isArray(matches)).toBe(true);
});
