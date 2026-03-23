"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { PlayerCard } from "@/components/player-card";
import { MatchCard } from "@/components/match-card";
import { CategoryFilter } from "./category-filter";

import type { MatchDetail, UpcomingMatchDetail } from "@/lib/api-client";

interface Tournament {
  id: number;
  name: string;
  club: string | null;
  date: string | null;
  linkWeb: string | null;
}

interface TournamentPlayer {
  id: number;
  name: string;
  club: string | null;
  photoUrl: string | null;
  licenseNumber: string | null;
  globalRank: number | null;
  genderRank: number | null;
  categoryRank: number | null;
  ordinal: number;
  rating: { score: number; reliability: number } | null;
  lastMatch: string | null;
}

interface MatchesData {
  upcoming: UpcomingMatchDetail[];
  completed: MatchDetail[];
}

export default function TournamentPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const category = searchParams.get("category") ?? undefined;

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [players, setPlayers] = useState<TournamentPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<MatchesData>({ upcoming: [], completed: [] });
  const [activeTab, setActiveTab] = useState<"players" | "upcoming" | "completed">("players");

  useEffect(() => {
    setLoading(true);
    const url = category
      ? `/api/tournaments/${id}?category=${encodeURIComponent(category)}`
      : `/api/tournaments/${id}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data) => {
        setTournament(data.tournament);
        setCategories(data.categories);
        setPlayers(data.players);
        setMatches(data.matches ?? { upcoming: [], completed: [] });
      })
      .finally(() => setLoading(false));
  }, [id, category]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!tournament) {
    return <p className="py-8 text-center text-muted-foreground">Tournament not found</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{tournament.name}</h1>
        <div className="text-sm text-muted-foreground">
          {tournament.club && <span>{tournament.club}</span>}
          {tournament.club && tournament.date && <span> · </span>}
          {tournament.date && <span>{tournament.date}</span>}
        </div>
      </div>

      {categories.length > 0 && (
        <CategoryFilter
          categories={categories}
          selected={category ?? null}
          tournamentId={tournament.id}
        />
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {[
          { key: "players" as const, label: "Players", count: players.length },
          { key: "upcoming" as const, label: "Upcoming", count: matches.upcoming.length },
          { key: "completed" as const, label: "Results", count: matches.completed.length },
        ].filter((t) => t.count > 0 || t.key === "players").map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label} {tab.count > 0 && <span className="ml-1 text-xs opacity-60">({tab.count})</span>}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {activeTab === "players" && (
          <>
            {players.length > 0 ? (
              [...players].sort((a, b) => {
                if (a.globalRank === null && b.globalRank === null) return 0;
                if (a.globalRank === null) return 1;
                if (b.globalRank === null) return -1;
                return a.globalRank - b.globalRank;
              }).map((player) => (
                <PlayerCard
                  key={player.id}
                  id={player.id}
                  name={player.name}
                  club={player.club}
                  photoUrl={player.photoUrl}
                  licenseNumber={player.licenseNumber}
                  globalRank={player.globalRank ?? 0}
                  rating={player.rating}
                  lastMatch={player.lastMatch}
                />
              ))
            ) : (
              <p className="py-8 text-center text-muted-foreground">No players found</p>
            )}
          </>
        )}

        {activeTab === "upcoming" && (
          <>
            {matches.upcoming.length > 0 ? (
              matches.upcoming.map((match) => (
                <MatchCard
                  key={match.guid}
                  match={match}
                  currentPlayerId={0}
                  court={match.court}
                  sideAWinProbability={match.sideAWinProbability}
                />
              ))
            ) : (
              <p className="py-8 text-center text-muted-foreground">No upcoming matches</p>
            )}
          </>
        )}

        {activeTab === "completed" && (
          <>
            {matches.completed.length > 0 ? (
              matches.completed.map((match) => (
                <MatchCard key={match.guid} match={match} currentPlayerId={0} />
              ))
            ) : (
              <p className="py-8 text-center text-muted-foreground">No completed matches</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
