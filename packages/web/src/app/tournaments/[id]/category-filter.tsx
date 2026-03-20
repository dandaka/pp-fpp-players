"use client";

import { useRouter } from "next/navigation";

interface CategoryFilterProps {
  categories: string[];
  selected: string | null;
  tournamentId: number;
}

export function CategoryFilter({ categories, selected, tournamentId }: CategoryFilterProps) {
  const router = useRouter();

  function handleChange(category: string | null) {
    const url = category
      ? `/tournaments/${tournamentId}?category=${encodeURIComponent(category)}`
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
          key={cat}
          onClick={() => handleChange(cat)}
          className={`rounded-full px-3 py-1 text-sm transition-colors ${
            selected === cat ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
