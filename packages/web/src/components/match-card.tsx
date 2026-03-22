import Link from "next/link";
import { Avatar, AvatarImage, AvatarFallback } from "./ui/avatar";
import type { MatchDetail, MatchPlayerInfo } from "@/lib/api-client";

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
        {player.photoUrl && <AvatarImage src={player.photoUrl} alt={player.name} />}
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
            <span className={`opacity-60 ${delta > 0 ? "text-green-600" : delta < 0 ? "text-red-500" : ""}`}>
              {delta > 0 ? "+" : ""}{(Math.round(delta * 10) / 10).toFixed(1)}
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

  const playerCols = isDoubles ? "auto auto 1fr" : "1fr";
  const scoreCols = hasScores ? ` 1.5rem${" auto".repeat(sets.length)}` : "";
  const probCols = hasProb ? " 1rem 3.5rem auto" : "";
  const gridCols = `${playerCols}${scoreCols}${probCols}`;

  const winPct = hasProb ? Math.round(prob! * 100) : 0;
  const losePct = hasProb ? 100 - winPct : 0;

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div
        className="grid items-center gap-x-2 gap-y-2"
        style={{ gridTemplateColumns: gridCols }}
      >
        {/* Side A row */}
        <PlayerCell player={sideA[0]} isWinnerSide={winnerSide === "a"} />
        {isDoubles && (
          <>
            <span className="text-muted-foreground text-sm">×</span>
            <PlayerCell player={sideA[1]} isWinnerSide={winnerSide === "a"} />
          </>
        )}
        {hasScores && <span />}
        {sets.map((s, i) => (
          <span
            key={i}
            className={`text-sm ${s.setA > s.setB ? "font-semibold" : "text-muted-foreground"}`}
          >
            {s.setA}
          </span>
        ))}
        {hasProb && (
          <>
            <span />
            <div className="flex h-2 rounded-full overflow-hidden bg-muted">
              <div
                className="bg-foreground/60 rounded-l-full"
                style={{ width: `${winPct}%` }}
              />
              <div
                className="bg-foreground/20 rounded-r-full"
                style={{ width: `${losePct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{winPct}% win</span>
          </>
        )}

        {/* Side B row */}
        <PlayerCell player={sideB[0]} isWinnerSide={winnerSide === "b"} />
        {isDoubles && (
          <>
            <span className="text-muted-foreground text-sm">×</span>
            <PlayerCell player={sideB[1]} isWinnerSide={winnerSide === "b"} />
          </>
        )}
        {hasScores && <span />}
        {sets.map((s, i) => (
          <span
            key={i}
            className={`text-sm ${s.setB > s.setA ? "font-semibold" : "text-muted-foreground"}`}
          >
            {s.setB}
          </span>
        ))}
        {hasProb && (
          <>
            <span />
            <span />
            <span />
          </>
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
            <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">W/O</span>
          )}
          {resultType === "retired" && (
            <span className="shrink-0 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">Ret.</span>
          )}
        </div>
        {match.dateTime && (
          <span className="shrink-0 ml-2">{match.dateTime}</span>
        )}
      </div>
    </div>
  );
}
