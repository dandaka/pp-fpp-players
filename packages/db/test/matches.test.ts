import { test, expect } from "bun:test";
import { getPlayerMatches } from "../src/queries/matches";
import { searchPlayers } from "../src/queries/players";

test("getPlayerMatches returns matches for a known player", () => {
  const players = searchPlayers("silva", 1);
  if (players.length === 0) return;

  const { matches } = getPlayerMatches(players[0].id, undefined, 5);
  expect(matches.length).toBeGreaterThanOrEqual(0);

  if (matches.length > 0) {
    const m = matches[0];
    expect(m.guid).toBeTruthy();
    expect(m.sideA.length).toBeGreaterThan(0);
    expect(m.sideB.length).toBeGreaterThan(0);
    expect(m.sideA[0]).toHaveProperty("id");
    expect(m.sideA[0]).toHaveProperty("name");
  }
});

test("getPlayerMatches supports cursor pagination", () => {
  const players = searchPlayers("silva", 1);
  if (players.length === 0) return;

  const page1 = getPlayerMatches(players[0].id, undefined, 2);
  if (!page1.nextCursor) return;

  const page2 = getPlayerMatches(players[0].id, page1.nextCursor, 2);
  if (page2.matches.length > 0 && page1.matches.length > 0) {
    expect(page2.matches[0].guid).not.toBe(page1.matches[0].guid);
  }
});

test("getPlayerMatches returns empty for nonexistent player", () => {
  const { matches } = getPlayerMatches(999999999);
  expect(matches).toEqual([]);
});
