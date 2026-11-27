import { getGitHubFavoritesForUi } from "@/lib/data/github-favorite-ui";
import { getAllResources } from "@/lib/data/resources";
import type { ArchiveCatalogData } from "@/lib/types/archive-catalog";

export const dynamic = "force-static";

export async function GET() {
  const [resources, githubFavorites] = await Promise.all([getAllResources(), getGitHubFavoritesForUi()]);
  const facets: ArchiveCatalogData["facets"] = [];
  const indices = new Map<string, number>();
  function facetIndex(facet: typeof resources[number]["facet"]) {
    if (!facet) return undefined;
    const key = JSON.stringify(facet);
    const existing = indices.get(key);
    if (existing !== undefined) return existing;
    const index = facets.push(facet) - 1;
    indices.set(key, index);
    return index;
  }
  return Response.json({
    resources: resources.map((resource) => ({
      id: resource.id, title: resource.title, url: resource.url, collection: resource.collection,
      category: resource.category, subcategory: resource.subcategory, tocPath: resource.tocPath,
      language: resource.language, type: resource.type, facetIndex: facetIndex(resource.facet), tags: resource.tags,
      quality: resource.quality, source: resource.source, sourcePath: resource.sourcePath,
      updatedAt: resource.updatedAt, detailSummary: resource.detailSummary ?? resource.cardSummary ?? resource.summary,
    })),
    facets,
    githubFavorites,
  } satisfies ArchiveCatalogData, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
