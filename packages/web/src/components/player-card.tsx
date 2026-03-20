import Link from "next/link";
import { RankBadge } from "./rank-badge";

interface PlayerCardProps {
  id: number;
  name: string;
  club: string | null;
  globalRank: number;
}

export function PlayerCard({ id, name, club, globalRank }: PlayerCardProps) {
  return (
    <Link href={`/players/${id}`} className="block">
      <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          {club && <p className="truncate text-sm text-muted-foreground">{club}</p>}
        </div>
        <RankBadge rank={globalRank} className="ml-2 shrink-0" />
      </div>
    </Link>
  );
}
