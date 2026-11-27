"use client";

import { useEffect, useRef, useState } from "react";
import type { RecommendationPick, RecommendOptions } from "@/lib/data/recommend";

const endpoint = process.env.NEXT_PUBLIC_AI_PLANNER_URL;

interface Quota {
  remaining: number;
  resetAt: number;
}

export default function HostedPlan({ criteria, picks }: { criteria: RecommendOptions; picks: RecommendationPick[] }) {
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [plan, setPlan] = useState("");
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<Quota | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => {
    if (!quota) return;
    const timer = window.setTimeout(() => setQuota(null), Math.max(0, quota.resetAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [quota]);

  if (!endpoint) return null;
  const exhausted = quota?.remaining === 0;
  const longGoal = criteria.goal.length > 500;

  async function generate() {
    if (!endpoint || request.current || exhausted || longGoal) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 60000);
    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...criteria, titles: picks.map(pick => pick.title.slice(0, 300)) }),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      const payload = await response.json();
      if (typeof payload.remaining === "number" && typeof payload.resetAt === "number") {
        setQuota({ remaining: payload.remaining, resetAt: payload.resetAt });
      }
      if (response.status === 429) return;
      if (!response.ok || typeof payload.plan !== "string") {
        setError(response.status === 502 ? "模型暂时未能生成计划，本次调用已计入额度。" : "暂时无法生成计划，请稍后重试。");
        return;
      }
      setPlan(payload.plan);
    } catch {
      if (controller.signal.reason === "timeout") setError("等待回复超时，请稍后重试。");
      else if (!controller.signal.aborted) setError("未收到回复，请检查网络后再试。");
    } finally {
      window.clearTimeout(timeout);
      request.current = null;
      if (!controller.signal.aborted || controller.signal.reason === "timeout") setPending(false);
    }
  }

  return (
    <section aria-labelledby="ai-plan-heading" className="archive-card p-5 space-y-3">
      <h3 id="ai-plan-heading" className="text-base font-semibold text-archive-text">第一周学习计划</h3>
      <p className="text-sm leading-relaxed text-archive-subtle">
        使用站方 AI，根据你的学习目标、筛选条件和资源标题安排练习。每个 IP 每天可调用 10 次。
      </p>
      <button type="button" onClick={generate} disabled={pending || exhausted || longGoal}
        className="btn-accent min-h-11 px-4 text-sm disabled:opacity-60">
        {pending ? "正在生成…" : exhausted ? "今日额度已用完" : plan ? "重新生成（使用 1 次）" : "生成学习计划（使用 1 次）"}
      </button>
      <div role="status" aria-live="polite" className="text-sm text-archive-subtle">
        {longGoal ? "请将学习目标缩短至 500 字以内，再次生成资源推荐。" :
          pending ? "正在根据这些资源安排学习步骤…" :
          quota ? `此 IP 今日剩余 ${quota.remaining} 次。额度将在 ${new Date(quota.resetAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })} 重置。` : ""}
      </div>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {plan && <div className="border-t border-archive-border pt-3 whitespace-pre-wrap break-words text-sm leading-7 text-archive-text">{plan}</div>}
    </section>
  );
}
