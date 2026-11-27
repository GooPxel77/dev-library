"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function BackLinkInner() {
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  const from = params.get("from");
  params.delete("from");
  const suffix = params.size ? `?${params}` : "";
  const destination = from === "ai" ? `/recommend${suffix}#ai-results` : from === "recommend" ? `/recommend${suffix}#results` :
    from === "library" ? "/library" : `/resources${suffix}`;
  const label = from === "ai" ? "返回这组 AI 推荐" : from === "recommend" ? "返回这组推荐" : from === "library" ? "返回我的收藏" : "返回资源库";

  return (
    <Link
      href={destination}
      prefetch={false}
      className="inline-flex items-center gap-1.5 py-2.5 pr-4 font-mono text-xs text-archive-subtle hover:text-archive-text transition-colors mb-5 md:mb-8"
    >
      ← {label}
    </Link>
  );
}

export default function BackLink() {
  return (
    <Suspense fallback={
      <a
        href="/resources"
        className="inline-flex items-center gap-1.5 py-2.5 pr-4 font-mono text-xs text-archive-subtle hover:text-archive-text transition-colors mb-5 md:mb-8"
      >
        ← 返回资源库
      </a>
    }>
      <BackLinkInner />
    </Suspense>
  );
}
