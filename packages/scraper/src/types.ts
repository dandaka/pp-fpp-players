export const API_BASE = "https://api.tiesports.com";
export const API_TOKEN = "e7c75ca5-d749-47a2-a1d3-ae947f8eda81";
export const USER_AGENT = "TiePlayer/339 CFNetwork/3860.400.51 Darwin/25.3.0";

export interface ApiPlayerProfile {
  status: number;
  status_msg: string;
  player_name: string;
  player_photo: string;
  player_location: string;
  count_matches: number;
  list: Array<{ title: string; text: string; text2: string }>;
  share_url: string;
}

export interface ApiMatchPlayer {
  id: number;
  name: string;
  photo: string;
}

export interface ApiMatchSet {
  set_a: number;
  set_b: number;
  tie_a: number;
  tie_b: number;
}

export interface ApiMatch {
  id: string;
  side_a: ApiMatchPlayer[];
  side_b: ApiMatchPlayer[];
  total_a: string;
  total_b: string;
  sets: ApiMatchSet[];
  winner_a: boolean;
  winner_b: boolean;
  have_live_scores: boolean;
  infos: {
    title_left: string;
    title_right: string;
    date_time: { date: string; time: string; str: string };
    top_left: string;
    top_right: string;
    player_a_info: string;
    player_b_info: string;
  };
}

export interface ApiTournament {
  id: number;
  title: string;
  date: string;
  club: string;
  distance: string;
  cover: string;
  cover_ratio: number;
  today: boolean;
}

export interface ApiTournamentDetail {
  id: number;
  name: string;
  club: { id: number; name: string };
  header_texts: string[];
  info_texts: Array<{ title: string; text: string }>;
  location: {
    latitude: number;
    longitude: number;
    address: string;
  } | null;
  cover: string;
  link_web: string;
}

// --- Draws / Sections API types ---

export interface ApiSection {
  id: number;
  name: string;
}

export interface ApiRound {
  id: number;
  name: string;
  matches: ApiMatch[];
}

export interface ApiDrawsResponse {
  sections: ApiSection[];
  rounds: ApiRound[];
  web_url: string;
}

export interface ApiSectionPlayer {
  id: number;
  name: string;
  photo: string;
  national_id: string;
  age_group: string;
  ranking: string;
}

export interface ApiPlayerEntry {
  row_title: string;
  players: ApiSectionPlayer[];
  national_id: string;
  club: string;
  ranking: string;
  age_group: string;
}

export interface ApiPlayerEntriesResponse {
  list: ApiPlayerEntry[];
}
