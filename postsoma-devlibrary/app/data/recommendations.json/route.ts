import { getPlannerCatalog } from "@/lib/data/planner-catalog";

export const dynamic = "force-static";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
};

export async function GET() {
  const catalog = await getPlannerCatalog();
  return Response.json(catalog, { headers: CACHE_HEADERS });
}
