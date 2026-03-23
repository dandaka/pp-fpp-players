interface RatingBadgeProps {
  score: number;
  className?: string;
}

export function RatingBadge({ score, className = "" }: RatingBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground ${className}`}
      title={`Rating: ${Math.round(score)}`}
    >
      <span>{Math.round(score)}</span>
    </span>
  );
}
