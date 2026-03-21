"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button-variants";

interface Tournament {
  id: number;
  name: string;
  club: string | null;
  date: string | null;
}

export default function TournamentsPage() {
  const [query, setQuery] = useState("");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pageSize = 30;
  const totalPages = Math.ceil(total / pageSize);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const delay = query.trim() ? 300 : 0;

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        if (query.trim()) params.set("q", query.trim());
        const res = await fetch(`/api/tournaments?${params}`);
        const data = await res.json();
        setTournaments(data.tournaments);
        setTotal(data.total);
      } finally {
        setLoading(false);
      }
    }, delay);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, page]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search tournaments by name..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-12 text-base"
      />

      {loading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && tournaments.length > 0 && (
        <div className="space-y-2">
          {tournaments.map((t) => (
            <Link key={t.id} href={`/tournaments/${t.id}`} className="block">
              <div className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
                <p className="font-medium">{t.name}</p>
                <div className="flex gap-2 text-sm text-muted-foreground">
                  {t.club && <span>{t.club}</span>}
                  {t.club && t.date && <span>·</span>}
                  {t.date && <span>{t.date.split(" ")[0]}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && query.trim() && tournaments.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">No tournaments found</p>
      )}

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-4">
          {page > 1 && (
            <button onClick={() => setPage(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Previous
            </button>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <button onClick={() => setPage(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
}
