import { Elysia } from "elysia";
import cors from "@elysiajs/cors";
import {
  searchPlayers,
  getPlayer,
  getPlayerRanks,
  getPlayerRating,
  getPlayerTournamentsCount,
  getPlayerMatchesCount,
  getPlayerStartYear,
  getPlayerMatches,
  getPlayerUpcomingMatches,
  getTournaments,
  getTournament,
  getTournamentCategories,
  getTournamentPlayers,
  getTournamentMatches,
} from "@fpp/db";

const port = parseInt(process.env.API_PORT || "3001", 10);

const app = new Elysia()
  .use(cors())

  .get("/health", () => ({ status: "ok" }))

  .get("/players/search", ({ query }) => {
    const q = (query.q as string) || "";
    return searchPlayers(q, 20);
  })

  .get("/players/:id", ({ params, set }) => {
    const id = parseInt(params.id, 10);
    const player = getPlayer(id);
    if (!player) {
      set.status = 404;
      return { error: "Player not found" };
    }
    const ranks = getPlayerRanks(id);
    const rating = getPlayerRating(id);
    const tournamentsCount = getPlayerTournamentsCount(id);
    const matchesCount = getPlayerMatchesCount(id);
    const startYear = getPlayerStartYear(id);
    return { player, ranks, rating, tournamentsCount, matchesCount, startYear };
  })

  .get("/players/:id/matches", ({ params, query }) => {
    const id = parseInt(params.id, 10);
    const cursor = (query.cursor as string) || undefined;
    return getPlayerMatches(id, cursor, 20);
  })

  .get("/players/:id/upcoming", ({ params }) => {
    const id = parseInt(params.id, 10);
    return getPlayerUpcomingMatches(id);
  })

  .get("/tournaments", ({ query }) => {
    const page = parseInt((query.page as string) || "1", 10);
    const search = (query.q as string) || undefined;
    return getTournaments(page, 20, search);
  })

  .get("/tournaments/:id", ({ params, query, set }) => {
    const id = parseInt(params.id, 10);
    const category = (query.category as string) || undefined;

    const tournament = getTournament(id);
    if (!tournament) {
      set.status = 404;
      return { error: "Tournament not found" };
    }

    const categories = getTournamentCategories(id);
    const players = getTournamentPlayers(id, category);
    const matches = getTournamentMatches(id, category);

    return { tournament, categories, players, matches };
  })

  .listen(port);

console.log(`API server running at ${app.server?.url}`);
