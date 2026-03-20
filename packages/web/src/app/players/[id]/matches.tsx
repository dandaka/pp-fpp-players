"use client";

import { useState, useCallback, useEffect } from "react";
import { MatchCard } from "@/components/match-card";
import { InfiniteScroll } from "@/components/infinite-scroll";
import type { MatchDetail } from "@fpp/db";

interface PlayerMatchesProps {
  playerId: number;
}

export function PlayerMatches({ playerId }: PlayerMatchesProps) {
  const [matches, setMatches] = useState<MatchDetail[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

  const loadMore = useCallback(async () => {
    if (loading || cursor === null) return;
    setLoading(true);
    try {
      const url = `/api/matches/${playerId}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      setMatches((prev) => [...prev, ...data.matches]);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [playerId, cursor, loading]);

  useEffect(() => {
    if (initialLoad) {
      loadMore();
    }
  }, [initialLoad, loadMore]);

  if (!loading && matches.length === 0 && !initialLoad) {
    return <p className="py-4 text-center text-muted-foreground">No matches found</p>;
  }

  return (
    <div className="space-y-2">
      {matches.map((match) => (
        <MatchCard key={match.guid} match={match} currentPlayerId={playerId} />
      ))}
      <InfiniteScroll onLoadMore={loadMore} hasMore={cursor !== null} loading={loading} />
    </div>
  );
}
