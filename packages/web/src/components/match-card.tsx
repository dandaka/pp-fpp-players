import Link from "next/link";
import { Avatar, AvatarImage, AvatarFallback } from "./ui/avatar";
import type { MatchDetail, MatchPlayerInfo } from "@/lib/api-client";

function formatMatchDate(dateTime: string): string {
  // ISO format: "2025-03-27T22:30:00"
  const d = new Date(dateTime);
  if (isNaN(d.getTime())) return dateTime; // fallback to raw string
  const time = dateTime.includes("T00:00:00") ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return time ? `${time}, ${date}` : date;
}

function PlayerCell({
  player,
  isWinnerSide,
}: {
  player: MatchPlayerInfo;
  isWinnerSide: boolean;
}) {
  const ratingScore = player.ratingBefore ?? player.rating?.score ?? null;
  const delta = player.ratingDelta;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Avatar className="h-5 w-5 shrink-0">
        {player.photoUrl && (
          <AvatarImage src={player.photoUrl} alt={player.name} />
        )}
        <AvatarFallback className="text-[8px] bg-muted" />
      </Avatar>
      <Link
        href={`/players/${player.id}`}
        className={`truncate hover:underline ${isWinnerSide ? "font-semibold" : ""}`}
      >
        {player.name}
      </Link>
      {ratingScore != null && (
        <span className="inline-flex items-center shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground gap-1">
          <span>{Math.round(ratingScore)}</span>
          {delta != null && delta !== 0 && (
            <span
              className={`opacity-60 ${delta > 0 ? "text-green-600" : delta < 0 ? "text-red-500" : ""}`}
            >
              {delta > 0 ? "+" : ""}
              {(Math.round(delta * 10) / 10).toFixed(1)}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

interface MatchCardProps {
  match: MatchDetail;
  currentPlayerId: number;
  court?: string | null;
  sideAWinProbability?: number | null;
}

export function MatchCard({
  match,
  currentPlayerId,
  court,
  sideAWinProbability,
}: MatchCardProps) {
  const needsSwap =
    currentPlayerId > 0 && match.sideB.some((p) => p.id === currentPlayerId);

  const sideA = needsSwap ? match.sideB : match.sideA;
  const sideB = needsSwap ? match.sideA : match.sideB;
  const winnerSide = needsSwap
    ? match.winnerSide === "a"
      ? "b"
      : match.winnerSide === "b"
        ? "a"
        : match.winnerSide
    : match.winnerSide;
  const sets = needsSwap
    ? match.sets.map((s) => ({ setA: s.setB, setB: s.setA }))
    : match.sets;
  const prob = needsSwap
    ? sideAWinProbability != null
      ? 1 - sideAWinProbability
      : null
    : (sideAWinProbability ?? null);

  const resultType = match.resultType ?? "normal";
  const maxPlayers = Math.max(sideA.length, sideB.length);
  const isDoubles = maxPlayers > 1;
  const hasScores = sets.length > 0;
  const hasProb = prob != null && !hasScores;

  const winPct = hasProb ? Math.round(prob! * 100) : 0;

  // Format score as "6-4 7-5" style

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex gap-3">
        {/* Players column */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Side A */}
          <div className="space-y-0.5">
            <PlayerCell player={sideA[0]} isWinnerSide={winnerSide === "a"} />
            {isDoubles && (
              <PlayerCell player={sideA[1]} isWinnerSide={winnerSide === "a"} />
            )}
          </div>

          {/* Side B */}
          <div className="space-y-0.5">
            <PlayerCell player={sideB[0]} isWinnerSide={winnerSide === "b"} />
            {isDoubles && (
              <PlayerCell player={sideB[1]} isWinnerSide={winnerSide === "b"} />
            )}
          </div>
        </div>

        {/* Score column */}
        {hasScores && (
          <div
            className="shrink-0 grid items-center text-3xl font-mono leading-tight text-center"
            style={{
              gridTemplateColumns: `repeat(${sets.length}, minmax(1.5rem, auto))`,
              gap: "0.25rem 1rem",
            }}
          >
            {sets.map((s, i) => (
              <span
                key={`a${i}`}
                className={s.setA > s.setB ? "font-bold" : "text-muted-foreground"}
              >
                {s.setA}
              </span>
            ))}
            {sets.map((s, i) => (
              <span
                key={`b${i}`}
                className={s.setB > s.setA ? "font-bold" : "text-muted-foreground"}
              >
                {s.setB}
              </span>
            ))}
          </div>
        )}

        {/* Win probability column */}
        {hasProb && (
          <div className="shrink-0 flex flex-col items-end justify-start gap-1">
            <div className="w-20 rounded-full overflow-hidden bg-muted" style={{ height: "0.75rem" }}>
              <div
                className="bg-foreground/60 rounded-full"
                style={{ width: `${winPct}%`, height: "0.75rem" }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{winPct}% win</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="min-w-0 flex-1 flex items-center gap-1">
          {match.tournamentId ? (
            <Link
              href={`/tournaments/${match.tournamentId}`}
              className="hover:underline truncate"
            >
              {match.tournamentName}
            </Link>
          ) : (
            <span className="truncate">{match.tournamentName}</span>
          )}
          {court && <span className="shrink-0">· {court}</span>}
          {resultType === "walkover" && (
            <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              W/O
            </span>
          )}
          {resultType === "retired" && (
            <span className="shrink-0 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
              Ret.
            </span>
          )}
        </div>
        {match.dateTime && (
          <span className="shrink-0 ml-2">{formatMatchDate(match.dateTime)}</span>
        )}
      </div>
    </div>
  );
}
