// ---------------------------------------------------------------------------
// Typed API client for calling the backend from Next.js server components
// and API routes. All types are defined locally to avoid @fpp/db dependency.
// ---------------------------------------------------------------------------

// ── Types ──────────────────────────────────────────────────────────────────

export interface PlayerRating {
  score: number;
  reliability: number;
}

export interface PlayerSearchResult {
  id: number;
  name: string;
  club: string | null;
  photoUrl: string | null;
  licenseNumber: string | null;
  globalRank: number;
  rating: PlayerRating | null;
  lastMatch: string | null;
}

export interface Player {
  id: number;
  name: string;
  club: string | null;
  photoUrl: string | null;
  gender: string | null;
  location: string | null;
  ageGroup: string | null;
  fppPontos: number | null;
}

export interface PlayerRanks {
  global: { rank: number; total: number };
  gender: { rank: number; total: number; label: string } | null;
  club: { rank: number; total: number; label: string } | null;
}

export interface MatchPlayerInfo {
  id: number;
  name: string;
  photoUrl: string | null;
  categoryRank: number | null;
  genderRank: number | null;
  rating: PlayerRating | null;
  ratingBefore: number | null;
  ratingDelta: number | null;
}

export interface MatchDetail {
  guid: string;
  tournamentId: number | null;
  tournamentName: string | null;
  sectionName: string | null;
  roundName: string | null;
  dateTime: string | null;
  sets: Array<{ setA: number; setB: number; tieA: number; tieB: number }>;
  winnerSide: string | null;
  resultType: "normal" | "walkover" | "retired";
  sideA: MatchPlayerInfo[];
  sideB: MatchPlayerInfo[];
}

export interface UpcomingMatchDetail extends MatchDetail {
  court: string | null;
  category: string | null;
  subcategory: string | null;
  sideAWinProbability: number | null;
}

export interface Tournament {
  id: number;
  name: string;
  club: string | null;
  date: string | null;
}

export interface TournamentDetail {
  id: number;
  name: string;
  club: string | null;
  date: string | null;
  linkWeb: string | null;
}

export interface TournamentPlayer {
  id: number;
  name: string;
  club: string | null;
  photoUrl: string | null;
  licenseNumber: string | null;
  globalRank: number | null;
  genderRank: number | null;
  categoryRank: number | null;
  ordinal: number;
  rating: PlayerRating | null;
  lastMatch: string | null;
}

// ── Response shapes ────────────────────────────────────────────────────────

export interface GetPlayerResponse {
  player: Player;
  ranks: PlayerRanks | null;
  rating: PlayerRating | null;
  tournamentsCount: number;
  matchesCount: number;
  startYear: number | null;
}

export interface GetPlayerMatchesResponse {
  matches: MatchDetail[];
  nextCursor: string | null;
}

export interface GetTournamentsResponse {
  tournaments: Tournament[];
  total: number;
}

export interface GetTournamentResponse {
  tournament: TournamentDetail;
  categories: string[];
  players: TournamentPlayer[];
  totalPlayers: number;
  matches: {
    upcoming: UpcomingMatchDetail[];
    completed: MatchDetail[];
  };
}

// ── Client ─────────────────────────────────────────────────────────────────

const API_URL = process.env.API_URL || "http://localhost:3001";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getTopPlayers(limit = 50): Promise<PlayerSearchResult[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  return apiFetch<PlayerSearchResult[]>(`/players/top?${params}`);
}

export async function searchPlayers(
  query: string,
  limit = 20,
): Promise<PlayerSearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return apiFetch<PlayerSearchResult[]>(`/players/search?${params}`);
}

export async function getPlayer(id: number): Promise<GetPlayerResponse> {
  return apiFetch<GetPlayerResponse>(`/players/${id}`);
}

export async function getPlayerMatches(
  playerId: number,
  cursor?: string,
  limit = 20,
): Promise<GetPlayerMatchesResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return apiFetch<GetPlayerMatchesResponse>(
    `/players/${playerId}/matches?${params}`,
  );
}

export async function getPlayerUpcomingMatches(
  playerId: number,
): Promise<UpcomingMatchDetail[]> {
  return apiFetch<UpcomingMatchDetail[]>(`/players/${playerId}/upcoming`);
}

export async function getTournaments(
  page?: number,
  pageSize?: number,
  search?: string,
  filter?: string,
): Promise<GetTournamentsResponse> {
  const params = new URLSearchParams();
  if (page !== undefined) params.set("page", String(page));
  if (pageSize !== undefined) params.set("pageSize", String(pageSize));
  if (search) params.set("q", search);
  if (filter) params.set("filter", filter);
  const qs = params.toString();
  return apiFetch<GetTournamentsResponse>(
    `/tournaments${qs ? `?${qs}` : ""}`,
  );
}

export interface TournamentCounts {
  thisWeek: number;
  upcoming: number;
  past: number;
}

export async function getTournamentCounts(): Promise<TournamentCounts> {
  return apiFetch<TournamentCounts>("/tournaments/counts");
}

export async function getTournament(
  id: number,
  category?: string,
  page?: number,
): Promise<GetTournamentResponse> {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (page !== undefined) params.set("page", String(page));
  const qs = params.toString();
  return apiFetch<GetTournamentResponse>(
    `/tournaments/${id}${qs ? `?${qs}` : ""}`,
  );
}
