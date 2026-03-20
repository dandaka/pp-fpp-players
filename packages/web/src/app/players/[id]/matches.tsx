import { getPlayerMatches } from "@fpp/db";
import { MatchCard } from "@/components/match-card";

interface PlayerMatchesProps {
  playerId: number;
}

export function PlayerMatches({ playerId }: PlayerMatchesProps) {
  const { matches } = getPlayerMatches(playerId, undefined, 50);

  if (matches.length === 0) {
    return <p className="py-4 text-center text-muted-foreground">No matches found</p>;
  }

  return (
    <div className="space-y-2">
      {matches.map((match) => (
        <MatchCard key={match.guid} match={match} currentPlayerId={playerId} />
      ))}
    </div>
  );
}
