import { getTournaments, getTournamentCounts } from "@/lib/api-client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const page = parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(request.nextUrl.searchParams.get("pageSize") ?? "30", 10);
  const q = request.nextUrl.searchParams.get("q") ?? undefined;
  const filter = request.nextUrl.searchParams.get("filter") ?? undefined;

  try {
    const [data, counts] = await Promise.all([
      getTournaments(page, pageSize, q, filter),
      getTournamentCounts(),
    ]);
    return NextResponse.json({ ...data, counts });
  } catch (err) {
    console.error("API fetch failed:", err);
    return NextResponse.json({ tournaments: [], total: 0, counts: { thisWeek: 0, upcoming: 0, past: 0 } }, { status: 502 });
  }
}
