"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { RankBadge } from "@/components/rank-badge";
import { CategoryFilter } from "./category-filter";

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
  genderRank: number | null;
  categoryRank: number | null;
  ordinal: number;
}

interface TournamentMatchData {
  guid: string;
  category: string | null;
  subcategory: string | null;
  roundName: string | null;
  dateTime: string | null;
  court: string | null;
  sets: Array<{ setA: number; setB: number }>;
  winnerSide: string | null;
  sideA: Array<{ id: number; name: string }>;
  sideB: Array<{ id: number; name: string }>;
}

interface MatchesData {
  upcoming: TournamentMatchData[];
  completed: TournamentMatchData[];
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

  function renderMatchCard(match: TournamentMatchData) {
    const isUpcoming = !match.winnerSide;
    return (
      <div key={match.guid} className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex gap-2">
            {match.category && <span>{match.category}{match.subcategory ? `-${match.subcategory}` : ""}</span>}
            {match.roundName && <span>{match.roundName}</span>}
          </div>
          <div className="flex gap-2">
            {match.court && <span>{match.court}</span>}
            {match.dateTime && (
              <span>
                {new Date(match.dateTime).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}
                {" "}
                {match.dateTime.includes(" ") ? match.dateTime.split(" ")[1]?.substring(0, 5) : ""}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1">
          {/* Side A */}
          <div className={`flex items-center justify-between ${match.winnerSide === "a" ? "font-semibold" : ""}`}>
            <div className="flex gap-1">
              {match.sideA.map((p) => (
                <Link key={p.id} href={`/players/${p.id}`} className="hover:underline">{p.name}</Link>
              ))}
            </div>
            {!isUpcoming && (
              <div className="flex gap-2 text-sm tabular-nums">
                {match.sets.map((s, i) => <span key={i}>{s.setA}</span>)}
              </div>
            )}
          </div>

          {/* Side B */}
          <div className={`flex items-center justify-between ${match.winnerSide === "b" ? "font-semibold" : ""}`}>
            <div className="flex gap-1">
              {match.sideB.map((p) => (
                <Link key={p.id} href={`/players/${p.id}`} className="hover:underline">{p.name}</Link>
              ))}
            </div>
            {!isUpcoming && (
              <div className="flex gap-2 text-sm tabular-nums">
                {match.sets.map((s, i) => <span key={i}>{s.setB}</span>)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
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
              players.map((player, idx) => (
                <Link key={player.id} href={`/players/${player.id}`} className="block">
                  <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="shrink-0 w-8 text-right text-sm text-muted-foreground">{idx + 1}.</span>
                      <span className="truncate font-medium">{player.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <RankBadge rank={player.genderRank} label="gender" />
                      <RankBadge rank={player.categoryRank} label="cat" />
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <p className="py-8 text-center text-muted-foreground">No players found</p>
            )}
          </>
        )}

        {activeTab === "upcoming" && (
          <>
            {matches.upcoming.length > 0 ? (
              matches.upcoming.map(renderMatchCard)
            ) : (
              <p className="py-8 text-center text-muted-foreground">No upcoming matches</p>
            )}
          </>
        )}

        {activeTab === "completed" && (
          <>
            {matches.completed.length > 0 ? (
              matches.completed.map(renderMatchCard)
            ) : (
              <p className="py-8 text-center text-muted-foreground">No completed matches</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
