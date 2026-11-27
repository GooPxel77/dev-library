import { linkGitHubFavoritesToResources } from "./github-favorite-linking";
import { getGitHubFavoritesForUi } from "./github-favorite-ui";
import type { RecommendationResource } from "./recommend";
import { getAllResources, getRecommendationResources } from "./resources";

export interface PlannerProject {
  title: string;
  url: string;
  summary: string;
  whySaved?: string;
  bestFor?: string[];
  capabilities: string[];
  stack: string[];
  available: boolean;
}

export type PlannerCatalogRow = RecommendationResource & {
  project?: PlannerProject;
};

let cachedCatalog: PlannerCatalogRow[] | null = null;

export async function getPlannerCatalog(): Promise<PlannerCatalogRow[]> {
  if (cachedCatalog) return cachedCatalog;

  const [resources, catalog, favorites] = await Promise.all([
    getAllResources(),
    getRecommendationResources(),
    getGitHubFavoritesForUi(),
  ]);
  const { favoritesByResourceId } = linkGitHubFavoritesToResources(resources, favorites);

  cachedCatalog = catalog.map((row) => {
    const favorite = favoritesByResourceId.get(row.id);
    if (!favorite) return row;

    const bestFor = (favorite.editorial?.bestFor ?? [])
      .map((item) => item.trim())
      .filter((item) => item && !/^(?:Target Audience|Topic focus):/i.test(item))
      .slice(0, 3)
      .map((item) => item.slice(0, 120));
    const whySaved = favorite.whySaved?.trim().slice(0, 240);

    return {
      ...row,
      project: {
        title: favorite.title,
        url: favorite.githubUrl,
        summary: favorite.shortSummary.trim().slice(0, 900),
        ...(whySaved ? { whySaved } : {}),
        ...(bestFor.length ? { bestFor } : {}),
        capabilities: favorite.capabilities,
        stack: favorite.techStack,
        available:
          !favorite.githubArchived &&
          !favorite.githubDisabled &&
          !["archived", "unavailable"].includes(favorite.health),
      },
    };
  });

  return cachedCatalog;
}
