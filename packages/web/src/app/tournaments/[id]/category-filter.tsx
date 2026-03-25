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
        className={`cursor-pointer rounded-full px-3 py-1 text-sm transition-colors ${
          !selected ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
      >
        All
      </button>
      {categories.filter((cat) => cat.code && cat.name).map((cat) => (
        <button
          key={cat.code}
          onClick={() => handleChange(cat.code)}
          className={`cursor-pointer rounded-full px-3 py-1 text-sm transition-colors ${
            selected === cat.code ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
