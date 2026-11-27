import type { Resource, Difficulty } from "../types/resource";
import { getSearchAliases, normalizeLearningQuery } from "./search-aliases";

export type RecommendationResource = Pick<Resource,
  "id" | "title" | "url" | "language" | "type" | "category" | "subcategory" |
  "tags" | "collection" | "difficulty" | "summary" | "cardSummary" | "detailSummary" |
  "editorNote" | "source" | "quality"
>;

export interface RecommendOptions {
  goal: string;
  difficulty: "all" | Difficulty;
  language: "all" | "zh" | "en";
  format: "all" | "book" | "course" | "tutorial" | "documentation" | "interactive";
  apiKey?: string;
}

interface PickExplanation {
  whyMatch: string;
  relativeAdvantage: string;
  knownLimitations: string;
  suitableFor: string;
  notSuitableFor: string;
  alternative: string;
  evidenceStatus: "high" | "medium" | "low";
}

export interface RecommendationPick {
  resourceId: string;
  title: string;
  url: string;
  type: string;
  language: string;
  category: string;
  difficulty?: Difficulty;
  subcategory?: string;
  summary?: string;
  matchEvidence: string;
  take: "Quick Start" | "Comprehensive" | "Project-oriented" | "Featured Match";
  explanation: PickExplanation;
}

export interface RecommendationResult {
  generator: "local-rules";
  funnel: {
    totalRelated: number;
    matched: number;
    compared: number;
    returned: number;
  };
  picks: RecommendationPick[];
  relaxedReason?: string;
}

// Calculate evidence status based on Catalog Contract rules
function getEvidenceStatus(res: RecommendationResource): "high" | "medium" | "low" {
  const hasDesc = !!(res.summary || res.cardSummary || res.detailSummary);
  const hasDiff = !!res.difficulty;
  const hasNote = !!res.editorNote;
  const isFeatured = res.quality === "featured";
  const isGithub = res.source === "GitHub";

  if (hasDesc && (hasDiff || hasNote) && (isFeatured || isGithub)) {
    return "high";
  }
  if (hasDesc || hasDiff || hasNote) {
    return "medium";
  }
  return "low";
}

// Heuristic rule generator for pick explanation text
function generateHeuristicExplanation(
  res: RecommendationResource,
  alternativeRes: RecommendationResource | null,
  langPref: "zh" | "en" | "all"
): PickExplanation {
  const isZh = langPref === "zh" || res.language === "zh";
  const altTitle = alternativeRes ? alternativeRes.title : (isZh ? "浏览分类下的其他项目" : "Browse other catalog items");
  const evStatus = getEvidenceStatus(res);

  const typeNames: Record<string, string> = {
    book: "书籍", course: "课程", tutorial: "教程", article: "文章",
    interactive: "交互式资源", documentation: "文档",
  };
  const typeName = typeNames[res.type] || "资源";
  if (isZh) {
    return {
      whyMatch: "根据目录中的标题、分类和标签等信息匹配。",
      relativeAdvantage: `目录将此项归为${typeName}。`,
      knownLimitations: "推荐基于目录信息，内容质量和更新状态请到原站核实。",
      suitableFor: res.difficulty ? `目录标注难度：${res.difficulty}。` : "目录未标注难度。",
      notSuitableFor: "目录信息不足以判断是否适合每位学习者。",
      alternative: `其他候选：${altTitle}`,
      evidenceStatus: evStatus,
    };
  }
  return {
    whyMatch: "Matched using catalog information such as title, category, and tags.",
    relativeAdvantage: `Catalog format: ${res.type}.`,
    knownLimitations: "Recommendations use catalog data; check the source for quality and currency.",
    suitableFor: res.difficulty ? `Catalog difficulty: ${res.difficulty}.` : "Difficulty is not specified in the catalog.",
    notSuitableFor: "The catalog does not contain enough information to assess every learner's needs.",
    alternative: `Another candidate: ${altTitle}`,
    evidenceStatus: evStatus,
  };
}

/** Avoid treating words such as "algorithm" or "google" as the Go language. */
function matchesToken(text: string, token: string): boolean {
  if (token === "go") {
    return /(?:^|[^a-z0-9])(?:go|golang)(?=$|[^a-z0-9])/i.test(text);
  }
  return text.includes(token);
}

function explainMatch(resource: RecommendationResource, tokens: string[]): string {
  const fields: [string, string][] = [
    ["标题", resource.title],
    ...resource.tags.map((tag): [string, string] => ["标签", tag]),
    ["分类", resource.subcategory || ""],
    ["分类", resource.category],
    ["简介", resource.summary || resource.cardSummary || ""],
  ];
  for (const [label, value] of fields) {
    const normalized = value.toLowerCase();
    const hits = tokens.filter((token) => matchesToken(normalized, token));
    if (hits.length) {
      return `${label}匹配 · ${hits.map((token) => {
        const start = normalized.indexOf(token);
        return value.slice(start, start + token.length);
      }).join("、")}`;
    }
  }
  return resource.subcategory || resource.category;
}

// Client/Server shared matching engine
export async function matchAndRecommend(all: RecommendationResource[], options: RecommendOptions): Promise<RecommendationResult> {

  // 1. Language filter (Strict)
  let filtered = all;
  if (options.language !== "all") {
    filtered = filtered.filter((r) => r.language === options.language);
  }

  // 2. Format filter (Prefiltered)
  let formatFiltered = filtered;
  if (options.format !== "all") {
    formatFiltered = filtered.filter((r) => {
      if (options.format === "interactive") {
        return r.type === "interactive" || r.collection === "interactive";
      }
      return r.type === options.format;
    });
  }

  // 3. Difficulty filter (Prefiltered)
  let diffFiltered = formatFiltered;
  if (options.difficulty !== "all") {
    diffFiltered = formatFiltered.filter((r) => r.difficulty === options.difficulty);
  }

  const goal = normalizeLearningQuery(options.goal).toLowerCase();
  const aliases = getSearchAliases(goal);
  const words = goal.split(/[\s,，。/、]+/).filter(Boolean);
  const queryTokens = aliases.length
    ? [goal, ...aliases]
    : Array.from(new Set(words.flatMap((word) => [word, ...getSearchAliases(word)])));

  const countScoredMatches = (list: RecommendationResource[]) => {
    let cnt = 0;
    for (const res of list) {
      const title = res.title.toLowerCase();
      const cat = res.category.toLowerCase();
      const subcat = (res.subcategory || "").toLowerCase();
      const tags = res.tags.map((t) => t.toLowerCase());
      const summary = (res.summary || res.cardSummary || "").toLowerCase();
      let hasToken = false;
      for (const token of queryTokens) {
        if (
          matchesToken(cat, token) ||
          matchesToken(subcat, token) ||
          matchesToken(title, token) ||
          tags.some((t) => matchesToken(t, token)) ||
          matchesToken(summary, token)
        ) {
          hasToken = true;
          break;
        }
      }
      if (hasToken) cnt++;
    }
    return cnt;
  };

  let finalFiltered = diffFiltered;
  let relaxedReason = "";

  if (options.difficulty !== "all" && countScoredMatches(finalFiltered) < 3) {
    finalFiltered = formatFiltered.filter((r) => r.difficulty === options.difficulty || r.difficulty === undefined);
    relaxedReason = "符合指定难度的匹配项不足 3 项，已放宽条件，允许未标记难度的资源参与。";
  }

  if (options.format !== "all" && countScoredMatches(finalFiltered) < 3) {
    let relaxedFormatFiltered = filtered;
    if (options.difficulty !== "all") {
      relaxedFormatFiltered = filtered.filter((r) => r.difficulty === options.difficulty || r.difficulty === undefined);
    }
    finalFiltered = relaxedFormatFiltered;
    relaxedReason = (relaxedReason ? relaxedReason + " " : "") + "符合指定类型的匹配项不足 3 项，已放宽类型条件。";
  }

  const totalRelated = finalFiltered.length;

  interface ScoredResource {
    resource: RecommendationResource;
    score: number;
  }

  const scoredList: ScoredResource[] = [];

  for (const res of finalFiltered) {
    let score = 0;
    const title = res.title.toLowerCase();
    const cat = res.category.toLowerCase();
    const subcat = (res.subcategory || "").toLowerCase();
    const tags = res.tags.map((t) => t.toLowerCase());
    const summary = (res.summary || res.cardSummary || "").toLowerCase();

    for (const token of queryTokens) {
      if (matchesToken(cat, token)) score += 15;
      if (matchesToken(subcat, token)) score += 10;
      if (matchesToken(title, token)) score += 10;
      if (tags.some((t) => matchesToken(t, token))) score += 5;
      if (matchesToken(summary, token)) score += 2;
    }

    if (score > 0) {
      // Small curate boosts
      if (res.quality === "featured") score += 5;
      if (res.difficulty) score += 2;
      scoredList.push({ resource: res, score });
    }
  }

  // Sort descending by score
  scoredList.sort((a, b) => b.score - a.score);

  const matched = scoredList.map((x) => x.resource);
  // Include ties at the cutoff so catalog file order cannot crowd out another format.
  const cutoff = scoredList[7]?.score ?? 0;
  const comparedList = scoredList.filter((entry) => entry.score >= cutoff).map((entry) => entry.resource);

  const picks: RecommendationPick[] = [];

  if (comparedList.length > 0) {
    const usedIds = new Set<string>();
    function addPick(resource: RecommendationResource | undefined, take: RecommendationPick["take"]) {
      if (!resource || usedIds.has(resource.id)) return;
      usedIds.add(resource.id);
      const alternative = matched.find((r) => r.id !== resource.id && r.category === resource.category) ?? null;
      picks.push({
        resourceId: resource.id,
        title: resource.title,
        url: resource.url,
        type: resource.type,
        language: resource.language,
        category: resource.category,
        subcategory: resource.subcategory,
        difficulty: resource.difficulty,
        summary: resource.cardSummary || resource.summary,
        matchEvidence: explainMatch(resource, queryTokens),
        take,
        explanation: generateHeuristicExplanation(resource, alternative, options.language),
      });
    }

    addPick(comparedList.find((r) => ["tutorial", "interactive", "article"].includes(r.type)), "Quick Start");
    const inDepth = comparedList.find((r) => r.type === "book" || r.type === "course")
      ?? comparedList.find((r) => r.type === "documentation");
    addPick(inDepth, "Comprehensive");
    addPick(comparedList.find((r) => !usedIds.has(r.id) &&
      (r.collection === "github" || ["app", "library", "cli"].includes(r.type))), "Project-oriented");
    // Prefer another format among equally relevant candidates.
    for (const resource of comparedList) {
      if (picks.length === 3) break;
      if (!picks.some((pick) => pick.type === resource.type)) addPick(resource, "Featured Match");
    }
    for (const resource of comparedList) {
      if (picks.length === 3) break;
      addPick(resource, "Featured Match");
    }
  }

  // Recommendation logic runs purely on client-side heuristic rules (100% offline, 0 tracking, 0 external APIs)
  const generator: "local-rules" = "local-rules";

  return {
    generator,
    funnel: {
      totalRelated,
      matched: matched.length,
      compared: comparedList.length,
      returned: picks.length,
    },
    picks,
    relaxedReason: relaxedReason || undefined,
  };
}
