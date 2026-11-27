import { getPlannerCatalog } from "@/lib/data/planner-catalog";

export const dynamic = "force-static";

export async function GET() {
  const catalog = await getPlannerCatalog();
  return Response.json(catalog);
}
