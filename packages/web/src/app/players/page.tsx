"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { PlayerCard } from "@/components/player-card";
import { Skeleton } from "@/components/ui/skeleton";

interface PlayerResult {
  id: number;
  name: string;
  club: string | null;
  globalRank: number;
  rating: { score: number; reliability: number } | null;
}

export default function PlayersPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search players by name..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="text-base"
        autoFocus
      />
      {loading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}
      {!loading && results.length > 0 && (
        <div className="space-y-2">
          {results.map((player) => (
            <PlayerCard key={player.id} {...player} />
          ))}
        </div>
      )}
      {!loading && query.trim() && results.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">No players found</p>
      )}
      {!query.trim() && !loading && (
        <p className="py-8 text-center text-muted-foreground">
          Type a name to search players
        </p>
      )}
    </div>
  );
}
