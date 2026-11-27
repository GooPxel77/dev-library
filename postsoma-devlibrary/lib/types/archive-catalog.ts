import type { GitHubFavorite } from "./github-favorite";
import type { Resource, ResourceFacetMetadata } from "./resource";

export interface ArchiveCatalogData {
  resources: (Omit<Resource, "facet"> & { facetIndex?: number })[];
  facets: ResourceFacetMetadata[];
  githubFavorites: GitHubFavorite[];
}
