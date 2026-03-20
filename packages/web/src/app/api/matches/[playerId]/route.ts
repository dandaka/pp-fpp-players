import { getPlayerMatches } from "@fpp/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const { playerId } = await params;
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const result = getPlayerMatches(parseInt(playerId), cursor, 20);
  return NextResponse.json(result);
}
