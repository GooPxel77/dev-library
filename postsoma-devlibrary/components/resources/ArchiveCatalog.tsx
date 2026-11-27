"use client";

import { useEffect, useState } from "react";
import type { GitHubFavorite } from "@/lib/types/github-favorite";
import type { Resource } from "@/lib/types/resource";
import type { ArchiveCatalogData } from "@/lib/types/archive-catalog";
import ResourceExplorer from "./ResourceExplorer";

type Catalog = { resources: Resource[]; githubFavorites: GitHubFavorite[] };
type Collection = { id: string; label: string; count: number };
let cachedCatalog: Catalog | undefined;

export default function ArchiveCatalog({ collections }: { collections: Collection[] }) {
  const [catalog, setCatalog] = useState<Catalog | undefined>(cachedCatalog);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cachedCatalog) {
      setCatalog(cachedCatalog);
      return;
    }
    const controller = new AbortController();
    async function load() {
      const response = await fetch("/data/explorer.json", { signal: controller.signal });
      if (!response.ok) throw new Error("Catalog unavailable");
      const data: ArchiveCatalogData = await response.json();
      if (controller.signal.aborted) return;
      cachedCatalog = {
        resources: data.resources.map(({ facetIndex, ...resource }) => ({
          ...resource, facet: facetIndex === undefined ? undefined : data.facets[facetIndex],
        })),
        githubFavorites: data.githubFavorites,
      };
      setCatalog(cachedCatalog);
    }
    load().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);

  if (catalog) return <ResourceExplorer {...catalog} collections={collections} />;
  if (failed) return (
    <div className="space-y-3 text-sm text-archive-subtle">
      <p role="alert">暂时无法载入资源目录。</p>
      <button className="btn-outline" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>
        重新载入
      </button>
    </div>
  );
  return <p role="status" className="text-sm text-archive-subtle">正在加载资源库…</p>;
}
