import { getTournaments } from "@/lib/api-client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const page = parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(request.nextUrl.searchParams.get("pageSize") ?? "30", 10);
  const q = request.nextUrl.searchParams.get("q") ?? undefined;

  try {
    const data = await getTournaments(page, pageSize, q);
    return NextResponse.json(data);
  } catch (err) {
    console.error("API fetch failed:", err);
    return NextResponse.json({ tournaments: [], total: 0 }, { status: 502 });
  }
}
