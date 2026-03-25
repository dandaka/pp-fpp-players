import { API_BASE, API_TOKEN, USER_AGENT } from "./types";
import type { ApiPlayerProfile, ApiMatch, ApiTournament, ApiTournamentDetail, ApiDrawsResponse, ApiPlayerEntry } from "./types";

const headers = {
  Accept: "application/json",
  "User-Agent": USER_AGENT,
};

async function get(path: string): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API_BASE}${path}${sep}token=${API_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json();
}

export async function getPlayerProfile(playerId: number): Promise<ApiPlayerProfile> {
  return get(`/player.asmx/get_profile?player_id=${playerId}`) as Promise<ApiPlayerProfile>;
}

export async function getPlayerMatches(playerId: number, year: number): Promise<ApiMatch[]> {
  const allMatches: ApiMatch[] = [];
  let offset = 0;
  const pageSize = 50;

  while (true) {
    const data = (await get(
      `/matches.asmx/get_matches_v1?player_id=${playerId}&type=0&sport_id=2&year=${year}&count_matches=${offset}`
    )) as { list: ApiMatch[] };
    const page = data.list ?? [];
    if (page.length === 0) break;
    allMatches.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }

  return allMatches;
}

export async function getTournaments(offset = 0): Promise<ApiTournament[]> {
  const data = (await get(
    `/tournaments.asmx/get_tournaments_v2?find_by_name=&count_tournaments=${offset}`
  )) as { list: ApiTournament[] };
  return data.list ?? [];
}

export async function getTournament(tournamentId: number): Promise<ApiTournamentDetail> {
  const data = (await get(
    `/tournaments.asmx/get_tournament?tournament_id=${tournamentId}`
  )) as { obj: ApiTournamentDetail };
  return data.obj;
}

export async function getTournamentMatches(
  tournamentId: number,
  offset = 0
): Promise<{ matches: ApiMatch[]; hasMore: boolean }> {
  const data = (await get(
    `/tournaments.asmx/get_homepage_matches?tournament_id=${tournamentId}&count_items=${offset}&flag=ultimos`
  )) as { lists: ApiMatch[]; load_more_latest: boolean };
  return { matches: data.lists ?? [], hasMore: data.load_more_latest ?? false };
}

export async function getMatchDetail(matchGuid: string): Promise<unknown> {
  return get(`/matches.asmx/get_match_v1?match_id=${matchGuid}&Set_Match_id=0`);
}

export async function getTournamentDraws(
  tournamentId: number,
  sectionId = 0
): Promise<ApiDrawsResponse> {
  const data = (await get(
    `/tournaments.asmx/get_matches?tournament_id=${tournamentId}&section_id=${sectionId}&round=0&count_items=0`
  )) as ApiDrawsResponse;
  return {
    sections: data.sections ?? [],
    rounds: data.rounds ?? [],
    web_url: (data as any).web_url ?? "",
  };
}

export async function getSectionPlayers(
  sectionId: number,
  offset = 0
): Promise<ApiPlayerEntry[]> {
  const data = (await get(
    `/tournaments.asmx/get_players_by_section?section_id=${sectionId}&count_items=${offset}`
  )) as { list: ApiPlayerEntry[] };
  return data.list ?? [];
}

export async function getUpcomingMatches(
  tournamentId: number,
  offset = 0,
  flag = ""
): Promise<{ matches: ApiMatch[]; hasMore: boolean }> {
  const data = (await get(
    `/tournaments.asmx/get_homepage_matches?tournament_id=${tournamentId}&count_items=${offset}&flag=${flag}`
  )) as { lists: ApiMatch[]; load_more_latest: boolean };
  return { matches: data.lists ?? [], hasMore: data.load_more_latest ?? false };
}

export async function searchTournaments(
  query: string,
  offset = 0
): Promise<ApiTournament[]> {
  const data = (await get(
    `/tournaments.asmx/get_search_tournaments_v2?search_type=2&search_by_name=${encodeURIComponent(query)}&lat=0&lng=0&distance_km=100&filter_date=&count_tournaments=${offset}&country_id=0&city_id=0&age_group_id=0&categories=`
  )) as { list: ApiTournament[] };
  return data.list ?? [];
}
