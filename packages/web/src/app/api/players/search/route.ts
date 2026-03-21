import { searchPlayers } from "@/lib/api-client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const results = await searchPlayers(query, 20);
    return NextResponse.json(results);
  } catch (err) {
    console.error("API fetch failed:", err);
    return NextResponse.json([], { status: 502 });
  }
}
