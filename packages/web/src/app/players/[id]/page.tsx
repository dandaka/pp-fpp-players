import { getPlayer, getPlayerUpcomingMatches } from "@/lib/api-client";
import { notFound } from "next/navigation";
import { RatingBadge } from "@/components/rating-badge";
import { MatchCard } from "@/components/match-card";
import { PlayerMatches } from "./matches";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let data;
  try {
    data = await getPlayer(parseInt(id));
  } catch {
    notFound();
  }

  const { player, ranks, rating, tournamentsCount, matchesCount, startYear } = data;
  const upcomingMatches = await getPlayerUpcomingMatches(player.id);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        {player.photoUrl && (
          <img
            src={player.photoUrl}
            alt={player.name}
            className="h-16 w-16 rounded-full object-cover"
          />
        )}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{player.name}</h1>
            {rating && <RatingBadge score={rating.score} />}
          </div>
          {player.club && <p className="text-sm text-muted-foreground">{player.club}</p>}
          {player.location && <p className="text-sm text-muted-foreground">{player.location}</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Profile</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-4 space-y-1.5">
            {rating && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Rating</span>
                <span className="text-sm font-semibold">{rating.score}</span>
              </div>
            )}
            {rating && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Reliability</span>
                <span className="text-sm font-semibold">{rating.reliability}%</span>
              </div>
            )}
            {ranks && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Ranking</span>
                <span className="text-sm">
                  <span className="font-semibold">#{ranks.global.rank.toLocaleString()}</span>
                  <span className="text-muted-foreground"> ({ranks.global.total.toLocaleString()})</span>
                </span>
              </div>
            )}
          </div>
          <div className="rounded-lg border p-4 space-y-1.5">
            {tournamentsCount > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Tournaments</span>
                <span className="text-sm font-semibold">{tournamentsCount}</span>
              </div>
            )}
            {matchesCount > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Matches</span>
                <span className="text-sm font-semibold">{matchesCount}</span>
              </div>
            )}
            {startYear && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Started</span>
                <span className="text-sm font-semibold">{startYear}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {upcomingMatches.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Upcoming Match</h2>
          <div className="space-y-2">
            {upcomingMatches.map((match) => (
              <MatchCard
                key={match.guid}
                match={match}
                currentPlayerId={player.id}
                court={match.court}
                sideAWinProbability={match.sideAWinProbability}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Match History</h2>
        <PlayerMatches playerId={player.id} />
      </div>
    </div>
  );
}
