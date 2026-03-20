import { searchPlayers } from "@fpp/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const results = searchPlayers(query, 20);
  return NextResponse.json(results);
}
