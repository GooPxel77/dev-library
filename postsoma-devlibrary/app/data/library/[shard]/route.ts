import { libraryShard, type LibraryCard } from "@/lib/data/library-cards";
import { getAllResources } from "@/lib/data/resources";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [..."0123456789abcdef", "other"].map((key) => ({ shard: key + ".json" }));
}

export async function GET(_request: Request, { params }: { params: { shard: string } }) {
  const resources = await getAllResources();
  const cards: LibraryCard[] = resources
    .filter((r) => libraryShard(r.id) + ".json" === params.shard)
    .map((r) => ({
      id: r.id, title: r.title, url: r.url,
      type: r.facet?.resourceType ?? r.type,
      language: r.facet?.language ?? r.language,
    }));
  return Response.json(cards);
}
