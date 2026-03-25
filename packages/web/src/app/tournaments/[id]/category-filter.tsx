"use client";

import { useRouter } from "next/navigation";

export interface CategoryInfo {
  code: string;
  name: string;
  matchCount: number;
  playerCount: number;
}

interface CategoryFilterProps {
  categories: CategoryInfo[];
  selected: string | null;
  tournamentId: number;
}

export function CategoryFilter({ categories, selected, tournamentId }: CategoryFilterProps) {
  const router = useRouter();

  function handleChange(code: string | null) {
    const url = code
      ? `/tournaments/${tournamentId}?category=${encodeURIComponent(code)}`
      : `/tournaments/${tournamentId}`;
    router.push(url);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => handleChange(null)}
        className={`rounded-full px-3 py-1 text-sm transition-colors ${
          !selected ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat.code}
          onClick={() => handleChange(cat.code)}
          className={`rounded-full px-3 py-1 text-sm transition-colors ${
            selected === cat.code ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {cat.name}
          {cat.playerCount > 0 && (
            <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-0.5 text-xs dark:bg-white/10">
              {cat.playerCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
