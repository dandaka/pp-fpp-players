import { getPlayerMatches } from "@/lib/api-client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const { playerId } = await params;
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  try {
    const result = await getPlayerMatches(parseInt(playerId), cursor, 20);
    return NextResponse.json(result);
  } catch (err) {
    console.error("API fetch failed:", err);
    return NextResponse.json({ matches: [], nextCursor: null }, { status: 502 });
  }
}
