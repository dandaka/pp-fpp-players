export interface PlayerSearchResult {
  id: number
  name: string
  club: string | null
  photoUrl: string | null
  licenseNumber: string | null
  globalRank: number
  rating: PlayerRating | null
  lastMatch: string | null
}

export interface Player {
  id: number
  name: string
  club: string | null
  photoUrl: string | null
  gender: string | null
  location: string | null
  ageGroup: string | null
  fppPontos: number | null
}

export interface PlayerRanks {
  global: { rank: number; total: number }
  gender: { rank: number; total: number; label: string } | null
  club: { rank: number; total: number; label: string } | null
}

export interface MatchDetail {
  guid: string
  tournamentId: number | null
  tournamentName: string | null
  sectionName: string | null
  roundName: string | null
  dateTime: string | null
  sets: Array<{ setA: number; setB: number; tieA: number; tieB: number }>
  winnerSide: string | null
  resultType: "normal" | "walkover" | "retired"
  sideA: MatchPlayerInfo[]
  sideB: MatchPlayerInfo[]
}

export interface UpcomingMatchDetail extends MatchDetail {
  court: string | null
  category: string | null
  subcategory: string | null
  sideAWinProbability: number | null
}

export interface MatchPlayerInfo {
  id: number
  name: string
  photoUrl: string | null
  categoryRank: number | null
  genderRank: number | null
  rating: PlayerRating | null
  ratingBefore: number | null
  ratingDelta: number | null
}

export interface Tournament {
  id: number
  name: string
  club: string | null
  date: string | null
}

export interface TournamentDetail {
  id: number
  name: string
  club: string | null
  date: string | null
  linkWeb: string | null
}

export interface PlayerRating {
  score: number;       // 0.0–100.0, min-max normalized ordinal
  reliability: number; // 0–100, saturating curve from matches_counted
}

export interface TournamentPlayer {
  id: number
  name: string
  club: string | null
  photoUrl: string | null
  licenseNumber: string | null
  globalRank: number | null
  genderRank: number | null
  categoryRank: number | null
  ordinal: number
  rating: PlayerRating | null
  lastMatch: string | null
}

export interface TournamentMatch {
  guid: string
  category: string | null
  subcategory: string | null
  roundName: string | null
  dateTime: string | null
  court: string | null
  sets: Array<{ setA: number; setB: number; tieA: number; tieB: number }>
  winnerSide: string | null
  resultType: "normal" | "walkover" | "retired"
  sideA: Array<{ id: number; name: string }>
  sideB: Array<{ id: number; name: string }>
}
