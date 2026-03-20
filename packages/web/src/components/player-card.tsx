import Link from "next/link";
import { RankBadge } from "./rank-badge";
import { RatingBadge } from "./rating-badge";

interface PlayerCardProps {
  id: number;
  name: string;
  club: string | null;
  globalRank: number;
  rating: { score: number; reliability: number } | null;
}

export function PlayerCard({ id, name, club, globalRank, rating }: PlayerCardProps) {
  return (
    <Link href={`/players/${id}`} className="block">
      <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          {club && <p className="truncate text-sm text-muted-foreground">{club}</p>}
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {rating && <RatingBadge score={rating.score} reliability={rating.reliability} />}
          <RankBadge rank={globalRank} />
        </div>
      </div>
    </Link>
  );
}
