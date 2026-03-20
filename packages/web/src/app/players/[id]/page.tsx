import { getPlayer, getPlayerRanks, getPlayerRating } from "@fpp/db";
import { notFound } from "next/navigation";
import { RatingBadge } from "@/components/rating-badge";
import { PlayerMatches } from "./matches";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = getPlayer(parseInt(id));
  if (!player) notFound();

  const ranks = getPlayerRanks(player.id);
  const rating = getPlayerRating(player.id);

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
            {rating && <RatingBadge score={rating.score} reliability={rating.reliability} />}
          </div>
          {player.club && <p className="text-sm text-muted-foreground">{player.club}</p>}
          {player.location && <p className="text-sm text-muted-foreground">{player.location}</p>}
        </div>
      </div>

      {ranks && (
        <div className="rounded-lg border p-4 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Rankings</h2>
          <div className="space-y-1">
            <p className="text-sm">
              <span className="font-semibold">#{ranks.global.rank}</span>
              <span className="text-muted-foreground"> of {ranks.global.total.toLocaleString()} players</span>
            </p>
            {ranks.gender && (
              <p className="text-sm">
                <span className="font-semibold">#{ranks.gender.rank}</span>
                <span className="text-muted-foreground"> of {ranks.gender.total.toLocaleString()} {ranks.gender.label}</span>
              </p>
            )}
            {ranks.club && (
              <p className="text-sm">
                <span className="font-semibold">#{ranks.club.rank}</span>
                <span className="text-muted-foreground"> of {ranks.club.total.toLocaleString()} in {ranks.club.label}</span>
              </p>
            )}
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
