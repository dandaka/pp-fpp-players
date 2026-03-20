import { test, expect } from "bun:test";
import { searchPlayers, getPlayer, getPlayerRanks } from "../src/queries/players";

test("searchPlayers returns results for a common name", () => {
  const results = searchPlayers("silva");
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].name.toLowerCase()).toContain("silva");
  expect(results[0]).toHaveProperty("globalRank");
});

test("searchPlayers handles diacritics", () => {
  const results1 = searchPlayers("joao");
  const results2 = searchPlayers("joão");
  expect(results1.length).toBeGreaterThan(0);
  expect(results2.length).toBeGreaterThan(0);
});

test("searchPlayers returns empty for empty query", () => {
  expect(searchPlayers("")).toEqual([]);
  expect(searchPlayers("   ")).toEqual([]);
});

test("getPlayer returns player data", () => {
  const searchResults = searchPlayers("silva", 1);
  if (searchResults.length === 0) return;
  const player = getPlayer(searchResults[0].id);
  expect(player).not.toBeNull();
  expect(player!.name).toBeTruthy();
});

test("getPlayer returns null for nonexistent ID", () => {
  expect(getPlayer(999999999)).toBeNull();
});

test("getPlayerRanks returns ranks for rated player", () => {
  const results = searchPlayers("silva", 1);
  if (results.length === 0) return;
  const ranks = getPlayerRanks(results[0].id);
  if (ranks) {
    expect(ranks.global.rank).toBeGreaterThan(0);
    expect(ranks.global.total).toBeGreaterThan(0);
  }
});
