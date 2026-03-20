import Link from "next/link";
import { RankBadge } from "./rank-badge";
import { ScoreDisplay } from "./score-display";

import type { MatchDetail, MatchPlayerInfo } from "@fpp/db";

function PlayerName({ player, isWinnerSide }: { player: MatchPlayerInfo; isWinnerSide: boolean }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Link
        href={`/players/${player.id}`}
        className={`hover:underline ${isWinnerSide ? "font-semibold" : ""}`}
      >
        {player.name}
      </Link>
      <RankBadge rank={player.genderRank} />
      <RankBadge rank={player.categoryRank} label="cat" />
    </div>
  );
}

function SidePlayers({ players, isWinnerSide }: { players: MatchPlayerInfo[]; isWinnerSide: boolean }) {
  return (
    <div className="space-y-0.5">
      {players.map((p) => (
        <PlayerName key={p.id} player={p} isWinnerSide={isWinnerSide} />
      ))}
    </div>
  );
}

interface MatchCardProps {
  match: MatchDetail;
  currentPlayerId: number;
}

export function MatchCard({ match, currentPlayerId }: MatchCardProps) {
  const isOnSideA = match.sideA.some((p) => p.id === currentPlayerId);
  const playerWon = (isOnSideA && match.winnerSide === "a") || (!isOnSideA && match.winnerSide === "b");
  const hasResult = match.winnerSide !== null;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          {match.tournamentId ? (
            <Link href={`/tournaments/${match.tournamentId}`} className="text-sm text-muted-foreground hover:underline truncate block">
              {match.tournamentName}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground truncate block">{match.tournamentName}</span>
          )}
        </div>
        {hasResult && (
          <span className={`shrink-0 ml-2 rounded-md px-1.5 py-0.5 text-xs font-medium ${
            playerWon ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}>
            {playerWon ? "W" : "L"}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <SidePlayers players={match.sideA} isWinnerSide={match.winnerSide === "a"} />
        </div>
        <div className="shrink-0 text-muted-foreground text-xs">vs</div>
        <div className="flex-1 min-w-0">
          <SidePlayers players={match.sideB} isWinnerSide={match.winnerSide === "b"} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <ScoreDisplay sets={match.sets} winnerSide={match.winnerSide} />
        {match.dateTime && <span>{match.dateTime}</span>}
      </div>
    </div>
  );
}
