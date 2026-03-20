import { test, expect } from "bun:test";
import { getTournaments, getTournament, getTournamentPlayers } from "../src/queries/tournaments";

test("getTournaments returns paginated results", () => {
  const { tournaments, total } = getTournaments(1, 10);
  expect(total).toBeGreaterThan(0);
  expect(tournaments.length).toBeLessThanOrEqual(10);
  expect(tournaments[0]).toHaveProperty("id");
  expect(tournaments[0]).toHaveProperty("name");
});

test("getTournaments page 2 differs from page 1", () => {
  const page1 = getTournaments(1, 10);
  const page2 = getTournaments(2, 10);
  if (page2.tournaments.length > 0) {
    expect(page2.tournaments[0].id).not.toBe(page1.tournaments[0].id);
  }
});

test("getTournament returns detail for existing tournament", () => {
  const { tournaments } = getTournaments(1, 1);
  if (tournaments.length === 0) return;
  const detail = getTournament(tournaments[0].id);
  expect(detail).not.toBeNull();
  expect(detail!.name).toBeTruthy();
});

test("getTournament returns null for nonexistent", () => {
  expect(getTournament(999999999)).toBeNull();
});

test("getTournamentPlayers returns players for a tournament", () => {
  const { tournaments } = getTournaments(1, 1);
  if (tournaments.length === 0) return;
  const players = getTournamentPlayers(tournaments[0].id);
  expect(Array.isArray(players)).toBe(true);
});
