import { getTopPlayers } from "@/lib/api-client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);
  try {
    const results = await getTopPlayers(limit);
    return NextResponse.json(results);
  } catch (err) {
    console.error("API fetch failed:", err);
    return NextResponse.json([], { status: 502 });
  }
}
