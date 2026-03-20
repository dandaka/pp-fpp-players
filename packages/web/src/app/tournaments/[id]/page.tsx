import Link from "next/link";
import { getTournament, getTournamentCategories, getTournamentPlayers } from "@fpp/db";
import { notFound } from "next/navigation";
import { RankBadge } from "@/components/rank-badge";
import { CategoryFilter } from "./category-filter";

export default async function TournamentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { id } = await params;
  const { category } = await searchParams;

  const tournament = getTournament(parseInt(id));
  if (!tournament) notFound();

  const categories = getTournamentCategories(tournament.id);
  const players = getTournamentPlayers(tournament.id, category);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{tournament.name}</h1>
        <div className="text-sm text-muted-foreground">
          {tournament.club && <span>{tournament.club}</span>}
          {tournament.club && tournament.date && <span> · </span>}
          {tournament.date && <span>{tournament.date}</span>}
        </div>
      </div>

      {categories.length > 0 && (
        <CategoryFilter
          categories={categories}
          selected={category ?? null}
          tournamentId={tournament.id}
        />
      )}

      <div className="space-y-1">
        {players.length > 0 ? (
          players.map((player, idx) => (
            <Link key={player.id} href={`/players/${player.id}`} className="block">
              <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 w-8 text-right text-sm text-muted-foreground">{idx + 1}.</span>
                  <span className="truncate font-medium">{player.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <RankBadge rank={player.genderRank} label="gender" />
                  <RankBadge rank={player.categoryRank} label="cat" />
                </div>
              </div>
            </Link>
          ))
        ) : (
          <p className="py-8 text-center text-muted-foreground">No players found</p>
        )}
      </div>
    </div>
  );
}
