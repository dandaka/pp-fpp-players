import Link from "next/link";
import { getTournaments } from "@fpp/db";
import { buttonVariants } from "@/components/ui/button";

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1"));
  const pageSize = 30;
  const { tournaments, total } = getTournaments(page, pageSize);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Tournaments</h1>

      <div className="space-y-2">
        {tournaments.map((t) => (
          <Link key={t.id} href={`/tournaments/${t.id}`} className="block">
            <div className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
              <p className="font-medium">{t.name}</p>
              <div className="flex gap-2 text-sm text-muted-foreground">
                {t.club && <span>{t.club}</span>}
                {t.club && t.date && <span>·</span>}
                {t.date && <span>{t.date}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-4">
          {page > 1 && (
            <Link href={`/tournaments?page=${page - 1}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Previous
            </Link>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/tournaments?page=${page + 1}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
