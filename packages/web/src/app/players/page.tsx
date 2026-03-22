"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { PlayerCard } from "@/components/player-card";
import { Skeleton } from "@/components/ui/skeleton";

interface PlayerResult {
  id: number;
  name: string;
  club: string | null;
  licenseNumber: string | null;
  globalRank: number;
  rating: { score: number; reliability: number } | null;
  lastMatch: string | null;
}

export default function PlayersPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [topPlayers, setTopPlayers] = useState<PlayerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingTop, setLoadingTop] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetch("/api/players/top")
      .then((res) => res.json())
      .then((data) => setTopPlayers(data))
      .catch(() => {})
      .finally(() => setLoadingTop(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const showSearch = query.trim().length > 0;

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search by name or licence number..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-12 text-base"
        autoFocus
      />
      {loading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}
      {!loading && showSearch && results.length > 0 && (
        <div className="space-y-2">
          {results.map((player) => (
            <PlayerCard key={player.id} {...player} />
          ))}
        </div>
      )}
      {!loading && showSearch && results.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">No players found</p>
      )}
      {!showSearch && (
        <>
          <h2 className="text-sm font-medium text-muted-foreground">Top players by rating</h2>
          {loadingTop ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {topPlayers.map((player) => (
                <PlayerCard key={player.id} {...player} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
