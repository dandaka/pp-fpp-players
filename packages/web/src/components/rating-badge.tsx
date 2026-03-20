interface RatingBadgeProps {
  score: number;
  reliability?: number;
  className?: string;
}

export function RatingBadge({ score, reliability, className = "" }: RatingBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground ${className}`}
      title={`Rating: ${Math.round(score)}${reliability != null ? ` | Reliability: ${reliability}%` : ""}`}
    >
      <span>{Math.round(score)}</span>
      {reliability != null && (
        <>
          <span className="opacity-50">|</span>
          <span className="opacity-60">{reliability}%</span>
        </>
      )}
    </span>
  );
}
