import Link from "next/link";
import { RankBadge } from "./rank-badge";
import { RatingBadge } from "./rating-badge";

interface PlayerCardProps {
  id: number;
  name: string;
  club: string | null;
  photoUrl: string | null;
  licenseNumber: string | null;
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

export function PlayerCard({ id, name, photoUrl, licenseNumber, globalRank, rating, lastMatch }: PlayerCardProps) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Link href={`/players/${id}`} className="block">
      <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted">
            {photoUrl ? (
              <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-medium text-muted-foreground">
                {initials}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{name}</p>
            <div className="flex shrink-0 items-center gap-1.5">
              {rating && <RatingBadge score={rating.score} />}
              <RankBadge rank={globalRank} />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {lastMatch && <span className="shrink-0">{formatLastMatch(lastMatch)}</span>}
          </div>
          </div>
        </div>
        {licenseNumber && (
          <span className="ml-2 shrink-0 text-sm font-medium text-muted-foreground">
            Licence #{licenseNumber}
          </span>
        )}
      </div>
    </Link>
  );
}
