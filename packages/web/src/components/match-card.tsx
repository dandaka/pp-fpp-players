import Link from "next/link";
import { RatingBadge } from "./rating-badge";

import type { MatchDetail, MatchPlayerInfo } from "@fpp/db";

function PlayerCell({ player, isWinnerSide }: { player: MatchPlayerInfo; isWinnerSide: boolean }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <Link
        href={`/players/${player.id}`}
        className={`truncate hover:underline ${isWinnerSide ? "font-semibold" : ""}`}
      >
        {player.name}
      </Link>
      {player.rating && <RatingBadge score={player.rating.score} className="shrink-0" />}
    </div>
  );
}

interface MatchCardProps {
  match: MatchDetail;
  currentPlayerId: number;
  court?: string | null;
  sideAWinProbability?: number | null;
}

export function MatchCard({ match, court, sideAWinProbability }: MatchCardProps) {
  const maxPlayers = Math.max(match.sideA.length, match.sideB.length);
  const isDoubles = maxPlayers > 1;
  const hasScores = match.sets.length > 0;
  const hasProb = sideAWinProbability != null && !hasScores;

  const playerCols = isDoubles ? "auto auto auto" : "auto";
  const scoreCols = hasScores ? ` 1.5rem${" auto".repeat(match.sets.length)}` : "";
  const gridCols = `${playerCols}${scoreCols}`;

  const probA = hasProb ? Math.round(sideAWinProbability! * 100) : 0;
  const probB = hasProb ? 100 - probA : 0;
  const sideAFavored = probA >= 50;

  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="inline-grid items-center gap-x-2 gap-y-2" style={{ gridTemplateColumns: gridCols }}>
            {/* Side A row */}
            <PlayerCell player={match.sideA[0]} isWinnerSide={match.winnerSide === "a"} />
            {isDoubles && (
              <>
                <span className="text-muted-foreground text-sm">×</span>
                <PlayerCell player={match.sideA[1]} isWinnerSide={match.winnerSide === "a"} />
              </>
            )}
            {hasScores && <span />}
            {match.sets.map((s, i) => (
              <span key={i} className={`text-sm ${s.setA > s.setB ? "font-semibold" : "text-muted-foreground"}`}>
                {s.setA}
              </span>
            ))}

            {/* Side B row */}
            <PlayerCell player={match.sideB[0]} isWinnerSide={match.winnerSide === "b"} />
            {isDoubles && (
              <>
                <span className="text-muted-foreground text-sm">×</span>
                <PlayerCell player={match.sideB[1]} isWinnerSide={match.winnerSide === "b"} />
              </>
            )}
            {hasScores && <span />}
            {match.sets.map((s, i) => (
              <span key={i} className={`text-sm ${s.setB > s.setA ? "font-semibold" : "text-muted-foreground"}`}>
                {s.setB}
              </span>
            ))}
          </div>
        </div>
        {hasProb && (
          <div className="shrink-0 flex flex-col justify-center gap-2 w-32 self-center">
            {/* Favored side row */}
            <div className="flex items-center gap-1.5">
              <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-muted">
                {sideAFavored ? (
                  <>
                    <div className="bg-foreground/60 rounded-l-full" style={{ width: `${probA}%` }} />
                    <div className="bg-foreground/20 rounded-r-full" style={{ width: `${probB}%` }} />
                  </>
                ) : (
                  <div className="bg-foreground/10 rounded-full w-full" />
                )}
              </div>
              <span className="text-xs text-muted-foreground w-14 text-right">{sideAFavored ? `${probA}% win` : `${probA}% lose`}</span>
            </div>
            {/* Other side row */}
            <div className="flex items-center gap-1.5">
              <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-muted">
                {!sideAFavored ? (
                  <>
                    <div className="bg-foreground/60 rounded-l-full" style={{ width: `${probB}%` }} />
                    <div className="bg-foreground/20 rounded-r-full" style={{ width: `${probA}%` }} />
                  </>
                ) : (
                  <div className="bg-foreground/10 rounded-full w-full" />
                )}
              </div>
              <span className="text-xs text-muted-foreground w-14 text-right">{!sideAFavored ? `${probB}% win` : `${probB}% lose`}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="min-w-0 flex-1 flex items-center gap-1">
          {match.tournamentId ? (
            <Link href={`/tournaments/${match.tournamentId}`} className="hover:underline truncate">
              {match.tournamentName}
            </Link>
          ) : (
            <span className="truncate">{match.tournamentName}</span>
          )}
          {court && <span className="shrink-0">· {court}</span>}
        </div>
        {match.dateTime && <span className="shrink-0 ml-2">{match.dateTime}</span>}
      </div>
    </div>
  );
}
