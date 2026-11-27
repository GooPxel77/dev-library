import { NextRequest, NextResponse } from "next/server";
import { matchAndRecommend } from "@/lib/data/recommend";
import { getAllResources } from "@/lib/data/resources";
import type { Difficulty } from "@/lib/types/resource";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const goal = searchParams.get("goal") || "";
  const difficulty = (searchParams.get("difficulty") || "all") as "all" | Difficulty;
  const language = (searchParams.get("language") || "all") as "all" | "zh" | "en";
  const format = (searchParams.get("format") || "all") as
    | "all"
    | "book"
    | "course"
    | "tutorial"
    | "documentation"
    | "interactive";
  try {
    const all = await getAllResources();
    const result = await matchAndRecommend(all, {
      goal,
      difficulty,
      language,
      format,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("API recommend error:", error);
    return NextResponse.json(
      { error: "Failed to generate recommendation.", details: error.message },
      { status: 500 }
    );
  }
}
