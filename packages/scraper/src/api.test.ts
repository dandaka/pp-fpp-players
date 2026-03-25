import { test, expect, describe } from "bun:test";
import { getPlayerProfile, getPlayerMatches, getTournamentDraws, getSectionPlayers, getUpcomingMatches, searchTournaments } from "./api";

test("getPlayerProfile returns valid data", async () => {
  const profile = await getPlayerProfile(432061);
  expect(profile.status).toBe(1);
  expect(profile.player_name).toBeTruthy();
});

test("getPlayerMatches returns array", async () => {
  const matches = await getPlayerMatches(432061, 2026);
  expect(Array.isArray(matches)).toBe(true);
});

describe("getTournamentDraws", () => {
  test("returns sections and rounds for a known tournament", async () => {
    const result = await getTournamentDraws(23404);
    expect(result).toHaveProperty("sections");
    expect(result).toHaveProperty("rounds");
    expect(Array.isArray(result.sections)).toBe(true);
  });

  test("returns sections with id and name", async () => {
    const result = await getTournamentDraws(23404);
    if (result.sections.length > 0) {
      const section = result.sections[0];
      expect(typeof section.id).toBe("number");
      expect(typeof section.name).toBe("string");
    }
  });
});

describe("getSectionPlayers", () => {
  test("returns player entries for a section", async () => {
    const draws = await getTournamentDraws(23404);
    if (draws.sections.length === 0) return;
    const sectionId = draws.sections[0].id;
    const result = await getSectionPlayers(sectionId);
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty("players");
      expect(result[0]).toHaveProperty("row_title");
    }
  });
});

describe("getUpcomingMatches", () => {
  test("returns matches array", async () => {
    const result = await getUpcomingMatches(23404);
    expect(result).toHaveProperty("matches");
    expect(Array.isArray(result.matches)).toBe(true);
  });
});

describe("searchTournaments", () => {
  test("finds tournaments by name", async () => {
    const results = await searchTournaments("Padel");
    expect(Array.isArray(results)).toBe(true);
  });
});
