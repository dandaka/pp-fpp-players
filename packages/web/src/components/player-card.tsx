import Link from "next/link";
import { RankBadge } from "./rank-badge";
import { RatingBadge } from "./rating-badge";

interface PlayerCardProps {
  id: number;
  name: string;
  club: string | null;
  globalRank: number;
  rating: { score: number; reliability: number } | null;
  lastMatch: string | null;
}

function formatLastMatch(dateStr: string): string {
  // date_time values are inconsistent ("2025-12-07, 15:00", "2026-01-25 Início às 15:00", etc.)
  // Extract just the YYYY-MM-DD portion for reliable parsing
  const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) return "";
  const date = new Date(match[1] + "T00:00:00");
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return "today";
  if (diffDays === 1) return "1d ago";
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

export function PlayerCard({ id, name, club, globalRank, rating, lastMatch }: PlayerCardProps) {
  return (
    <Link href={`/players/${id}`} className="block">
      <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {club && <span className="truncate">{club}</span>}
            {lastMatch && (
              <>
                {club && <span>·</span>}
                <span className="shrink-0">{formatLastMatch(lastMatch)}</span>
              </>
            )}
          </div>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {rating && <RatingBadge score={rating.score} reliability={rating.reliability} />}
          <RankBadge rank={globalRank} />
        </div>
      </div>
    </Link>
  );
}
