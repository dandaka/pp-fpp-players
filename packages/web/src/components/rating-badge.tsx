interface RatingBadgeProps {
  score: number;
  reliability?: number;
  delta?: number | null;
  className?: string;
}

export function RatingBadge({ score, reliability, delta, className = "" }: RatingBadgeProps) {
  const roundedDelta = delta != null ? Math.round(delta * 10) / 10 : null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground ${className}`}
      title={`Rating: ${Math.round(score)}${reliability != null ? ` | Reliability: ${reliability}%` : ""}${roundedDelta != null ? ` | Delta: ${roundedDelta > 0 ? "+" : ""}${roundedDelta}` : ""}`}
    >
      <span>{Math.round(score)}</span>
      {roundedDelta != null && (
        <span className={roundedDelta > 0 ? "text-green-600" : roundedDelta < 0 ? "text-red-500" : "opacity-60"}>
          {roundedDelta > 0 ? "+" : ""}{roundedDelta.toFixed(1)}
        </span>
      )}
      {reliability != null && (
        <>
          <span className="opacity-50">|</span>
          <span className="opacity-60">{reliability}%</span>
        </>
      )}
    </span>
  );
}
