interface RankBadgeProps {
  rank: number | null;
  label?: string;
  className?: string;
}

export function RankBadge({ rank, label, className = "" }: RankBadgeProps) {
  if (rank === null) return null;
  return (
    <span className={`inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground ${className}`}>
      #{rank}{label ? ` ${label}` : ""}
    </span>
  );
}
