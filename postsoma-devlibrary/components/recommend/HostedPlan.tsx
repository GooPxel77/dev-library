"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RecommendOptions } from "@/lib/data/recommend";
import type { Resource } from "@/lib/types/resource";
import { getResourceDomain, TYPE_LABELS } from "@/lib/utils/resource";

export const hasHostedPlanner = Boolean(process.env.NEXT_PUBLIC_AI_PLANNER_URL);

export function resolvePlannerEndpoint() {
  return process.env.NEXT_PUBLIC_AI_PLANNER_URL || "/api/plan";
}

interface Quota { remaining: number; resetAt: number }
interface Entry { id: string; title: string; reason: string; fit: "direct" | "related"; url?: string; domain?: string; type?: string; language?: string }
interface Project { id: string; title: string; url: string; use: "learn" | "apply"; reason: string; step: string }
type PlannerCriteria = RecommendOptions & { includeProjects?: boolean };
interface Report { id: string; criteria: PlannerCriteria; projects?: Project[]; recommendations: Entry[]; compared: number; plan: string }

function readSession<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(key) || "null"); }
  catch { return null; }
}
function writeSession(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { /* Storage can be disabled. Keep the current result in memory. */ }
}

export function useHostedPlan(reportId: string | null, locationKey: string) {
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<Quota | null>(null);
  const generatedId = useRef("");
  useEffect(() => {
    const saved = readSession<Quota>("planner:quota");
    if (saved && saved.resetAt > Date.now()) setQuota(saved);
  }, []);
  useEffect(() => () => { request.current?.abort(); }, [locationKey]);
  useEffect(() => {
    if (reportId && reportId === generatedId.current) return;
    generatedId.current = "";
    const saved = reportId ? readSession<Report>("planner:result:" + reportId) : null;
    setReport(saved);
    setError(reportId && !saved ? "这组推荐保存在生成时的浏览器标签页。可输入目标重新生成。" : "");
  }, [reportId]);
  useEffect(() => {
    if (!quota) return;
    const timer = window.setTimeout(() => setQuota(null), Math.max(0, quota.resetAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [quota]);

  async function generate(criteria: PlannerCriteria, onReady: (id: string) => void) {
    const endpoint = resolvePlannerEndpoint();
    if (!endpoint || request.current || quota?.remaining === 0 || !criteria.goal || criteria.goal.length > 500) return;
    const controller = new AbortController();
    request.current = controller;
    const timer = window.setTimeout(() => controller.abort("timeout"), 85000);
    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(criteria),
        credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal,
      });
      const data = await response.json();
      if (typeof data.remaining === "number" && typeof data.resetAt === "number") {
        const latest = { remaining: data.remaining, resetAt: data.resetAt };
        setQuota(latest);
        writeSession("planner:quota", latest);
      }
      if (response.status === 429) return;
      if (!response.ok || typeof data.plan !== "string" || !Array.isArray(data.recommendations)) {
        setError(response.status === 502 ? "模型暂时未能完成推荐，本次已计入额度。" : "暂时无法取得推荐，请稍后重试。");
        return;
      }
      const id = crypto.randomUUID();
      const next = { id, criteria, plan: data.plan, compared: data.compared, recommendations: data.recommendations, projects: data.projects };
      generatedId.current = id;
      setReport(next);
      writeSession("planner:result:" + id, next);
      onReady(id);
    } catch {
      if (controller.signal.reason === "timeout") setError("等待回复超时，请稍后重试。");
      else if (!controller.signal.aborted) setError("未收到回复，请检查网络后重试。");
    } finally {
      window.clearTimeout(timer);
      request.current = null;
      setPending(false);
    }
  }
  return { report, error, quota, pending, generate };
}

export function HostedPlan({ report, changed }: { report: Report; changed: boolean }) {
  return (
    <section id="ai-results" aria-labelledby="ai-plan-heading" className="archive-card p-5 space-y-4 scroll-mt-20">
      <h2 id="ai-plan-heading" tabIndex={-1} className="text-lg font-semibold text-archive-text break-words">“{report.criteria.goal}”的 AI 推荐</h2>
      {changed && <p className="text-sm text-archive-accent">条件已修改。下方保留上一次结果，获取 AI 推荐后更新。</p>}
      {report.compared > 0 && <p className="text-sm text-archive-subtle">比较了 {report.compared} 项候选，选出 {report.recommendations.length} 项学习资料{report.projects?.length ? `和 ${report.projects.length} 个项目` : ""}。</p>}
      {report.recommendations.length > 0 && <h3 className="font-semibold">学习资料</h3>}
      {report.recommendations.length > 0 && <ol className="list-decimal space-y-4 pl-5">
        {report.recommendations.map(resource => {
          const typeLabel = resource.type ? TYPE_LABELS[resource.type as Resource["type"]] || resource.type : "";
          const langLabel = resource.language === "zh" ? "中文" : resource.language === "en" ? "英文" : "";
          const domain = resource.domain || getResourceDomain(resource.url);
          const meta = [typeLabel, langLabel, domain].filter(Boolean).join(" · ");
          return <li key={resource.id} className="space-y-1">
            <Link href={`/resource/${encodeURIComponent(resource.id)}?from=ai&ai=${report.id}`} className="text-archive-accent underline underline-offset-4">{resource.title}</Link>
            {meta && <p className="text-xs text-archive-subtle">{meta}</p>}
            <p className="text-sm leading-relaxed text-archive-text"><strong>{resource.fit === "direct" ? "直接匹配" : "延伸阅读"} · </strong>{resource.reason}</p>
            {resource.url && <a href={resource.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center text-sm text-archive-accent underline">访问原站 ↗</a>}
          </li>;
        })}
      </ol>}
      {report.projects && report.criteria.includeProjects !== false && <section className="space-y-3 border-t border-archive-border pt-3">
        <h3 className="font-semibold">GitHub 实作项目</h3>
        {report.projects.length === 0 && <p className="text-sm text-archive-subtle">本次没有找到与任务足够相关的收藏项目。</p>}
        {report.projects.map(project => <div key={project.id} className="space-y-1">
          <Link href={`/resource/${encodeURIComponent(project.id)}?from=ai&ai=${report.id}`} className="text-archive-accent underline underline-offset-4">{project.title}</Link>
          <p className="text-sm leading-relaxed"><strong>{project.use === "apply" ? "尝试应用" : "参考实现"} · </strong>{project.reason}</p>
          <p className="text-sm leading-relaxed">第一步：{project.step}</p>
          <a href={project.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-archive-accent underline">打开 GitHub 仓库 ↗</a>
        </div>)}
      </section>}
      <div className="border-t border-archive-border pt-3">
        {(report.recommendations.length > 0 || Boolean(report.projects?.length)) && <h3 className="mb-2 font-semibold">第一周学习计划</h3>}
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-archive-text">{report.plan}</p>
      </div>
    </section>
  );
}
