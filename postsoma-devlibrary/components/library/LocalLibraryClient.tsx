"use client";

import { useBookmarks } from "@/lib/local/bookmarks";
import { libraryShard, type LibraryCard } from "@/lib/data/library-cards";
import ResourceCard from "@/components/resources/ResourceCard";
import EmptyState from "@/components/ui/EmptyState";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LocalLibraryClient() {
  const { bookmarks } = useBookmarks();
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, LibraryCard[]>>({});
  const [failed, setFailed] = useState("");
  const router = useRouter();
  const missing = Array.from(new Set(bookmarks.map(libraryShard)))
    .filter((shard) => !loaded[shard]).sort().join(",");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!missing || missing === failed) return;
    const controller = new AbortController();
    async function load() {
      const entries = await Promise.all(missing.split(",").map(async (shard) => {
        const response = await fetch(`/data/library/${shard}.json`, { signal: controller.signal });
        if (!response.ok) throw new Error("Library data unavailable");
        return [shard, await response.json() as LibraryCard[]] as const;
      }));
      if (!controller.signal.aborted) {
        setLoaded((previous) => ({ ...previous, ...Object.fromEntries(entries) }));
        setFailed("");
      }
    }
    load().catch(() => { if (!controller.signal.aborted) setFailed(missing); });
    return () => controller.abort();
  }, [missing, failed]);

  if (missing && failed === missing) {
    return <div role="alert" className="space-y-3 text-sm text-archive-subtle">
      <p>暂时无法载入收藏的资源。</p>
      <button className="btn-outline" onClick={() => setFailed("")}>重新载入</button>
    </div>;
  }
  if (!mounted || missing) return <p role="status" className="text-sm text-archive-subtle">正在读取收藏…</p>;

  const cardsById = new Map(Object.values(loaded).flat().map((card) => [card.id, card]));
  const savedResources = bookmarks.flatMap((id) => cardsById.get(id) ?? []);
  return (
    <div className="animate-slide-up">
      {savedResources.length > 0 ? (
        <>
          <p className="mb-4 text-sm text-archive-subtle">已收藏 {savedResources.length} 项资源</p>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
            {savedResources.map((resource) => <ResourceCard key={resource.id} resource={resource} />)}
          </div>
        </>
      ) : (
        <EmptyState
          icon="bookmark"
          title="还没有收藏"
          description="在资源卡片上点击收藏按钮，方便以后回来查看。"
          action={{
            label: "浏览资源库",
            onClick: () => {
              router.push("/resources");
            },
          }}
        />
      )}
    </div>
  );
}
