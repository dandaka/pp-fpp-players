interface ScoreDisplayProps {
  sets: Array<{ setA: number; setB: number; tieA: number; tieB: number }>;
  winnerSide: string | null;
}

export function ScoreDisplay({ sets, winnerSide }: ScoreDisplayProps) {
  if (sets.length === 0) return <span className="text-sm text-muted-foreground">No score</span>;

  return (
    <div className="flex gap-2">
      {sets.map((set, i) => (
        <div key={i} className="text-center text-sm">
          <span className={winnerSide === "a" ? "font-semibold" : ""}>{set.setA}</span>
          <span className="text-muted-foreground">-</span>
          <span className={winnerSide === "b" ? "font-semibold" : ""}>{set.setB}</span>
        </div>
      ))}
    </div>
  );
}
