import { getTournament, getTournamentCategories, getTournamentPlayers, getTournamentMatches } from "@fpp/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const category = request.nextUrl.searchParams.get("category") ?? undefined;

  const tournament = getTournament(parseInt(id));
  if (!tournament) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const categories = getTournamentCategories(tournament.id);
  const players = getTournamentPlayers(tournament.id, category);
  const matches = getTournamentMatches(tournament.id, category);

  return NextResponse.json({ tournament, categories, players, matches });
}
