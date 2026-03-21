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
}

export function MatchCard({ match }: MatchCardProps) {
  const maxPlayers = Math.max(match.sideA.length, match.sideB.length);
  const isDoubles = maxPlayers > 1;
  // columns: player1, ×, player2, gap, score1, score2, ...
  const gridCols = isDoubles
    ? `auto auto auto 1.5rem${" auto".repeat(match.sets.length)}`
    : `auto 1.5rem${" auto".repeat(match.sets.length)}`;

  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="inline-grid items-center gap-x-2 gap-y-2" style={{ gridTemplateColumns: gridCols }}>
        {/* Side A row */}
        <PlayerCell player={match.sideA[0]} isWinnerSide={match.winnerSide === "a"} />
        {isDoubles && (
          <>
            <span className="text-muted-foreground text-sm">×</span>
            <PlayerCell player={match.sideA[1]} isWinnerSide={match.winnerSide === "a"} />
          </>
        )}
        <span />
        {match.sets.map((s, i) => (
          <span key={i} className={`text-sm ${match.winnerSide === "a" ? "font-semibold" : "text-muted-foreground"}`}>
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
        <span />
        {match.sets.map((s, i) => (
          <span key={i} className={`text-sm ${match.winnerSide === "b" ? "font-semibold" : "text-muted-foreground"}`}>
            {s.setB}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="min-w-0 flex-1">
          {match.tournamentId ? (
            <Link href={`/tournaments/${match.tournamentId}`} className="hover:underline truncate block">
              {match.tournamentName}
            </Link>
          ) : (
            <span className="truncate block">{match.tournamentName}</span>
          )}
        </div>
        {match.dateTime && <span className="shrink-0 ml-2">{match.dateTime}</span>}
      </div>
    </div>
  );
}
