import { getTournament } from "@/lib/api-client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const category = request.nextUrl.searchParams.get("category") ?? undefined;
  const page = request.nextUrl.searchParams.get("page") ?? undefined;

  try {
    const data = await getTournament(parseInt(id), category, page ? parseInt(page) : undefined);
    return NextResponse.json(data);
  } catch (err) {
    console.error("API fetch failed:", err);
    return NextResponse.json({ error: "Backend unavailable" }, { status: 502 });
  }
}
