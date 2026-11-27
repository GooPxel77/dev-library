import { describe, expect, it } from "vitest";
import { matchAndRecommend } from "../../lib/data/recommend";
import type { Resource } from "../../lib/types/resource";

describe("recommendation explanations", () => {
  it("does not claim an unverified documentation resource is official or current", async () => {
    const resource = {
      id: "third-party-python-docs",
      title: "Python documentation",
      url: "https://example.com/python",
      type: "documentation",
      language: "zh",
      category: "Python",
      tags: ["Python"],
    } as Resource;
    const result = await matchAndRecommend([resource], {
      goal: "Python", language: "zh", difficulty: "all", format: "all",
    });
    expect(result.picks).toHaveLength(1);
    const explanation = result.picks[0].explanation;
    expect(explanation.knownLimitations).toContain("原站核实");
    expect(Object.values(explanation).join(" ")).not.toMatch(/官方|最新|权威/);
  });
});


describe("short programming language queries", () => {
  it("matches Go and Golang without treating algorithm or Google as Go", async () => {
    const base: Omit<Resource, "id" | "title"> = { url: "https://example.com", type: "book", language: "en", tags: [], category: "Programming", collection: "books", quality: "standard", source: "free-programming-books", sourcePath: "books", updatedAt: "2026-01-01" };
    const resources: Resource[] = [
      { ...base, id: "algorithm", title: "Algorithms and Data Structures" },
      { ...base, id: "google", title: "Google Cloud Guide" },
      { ...base, id: "go", title: "Go Language" },
      { ...base, id: "golang", title: "Learn Golang" },
    ];
    const result = await matchAndRecommend(resources, { goal: "Go", language: "all", difficulty: "all", format: "all" });
    expect(result.funnel.matched).toBe(2);
    expect(result.picks.map((pick) => pick.resourceId).sort()).toEqual(["go", "golang"]);
  });
});

describe("bilingual learning goals", () => {
  const base = {
    url: "https://example.com", collection: "books", quality: "standard",
    source: "free-programming-books", sourcePath: "books", updatedAt: "2026-01-01",
  } as const;
  const catalog: Resource[] = [
    { ...base, id: "python", title: "Learn Python", language: "en", category: "Programming", tags: [], type: "book" },
    { ...base, id: "ml", title: "Machine Learning", language: "en", category: "AI", tags: [], type: "course" },
    { ...base, id: "zh", title: "机器学习入门", language: "zh", category: "AI", tags: [], type: "book" },
  ];
  it.each(["我想學Python", "我想学 Python", "我想学习Ｐｙｔｈｏｎ"])("recognizes the technical name in %s", async (goal) => {
    const result = await matchAndRecommend(catalog, { goal, language: "all", difficulty: "all", format: "all" });
    expect(result.picks.map((pick) => pick.resourceId)).toEqual(["python"]);
  });
  it("expands a traditional Chinese topic while respecting the selected language", async () => {
    const result = await matchAndRecommend(catalog, { goal: "我想學機器學習", language: "en", difficulty: "all", format: "all" });
    expect(result.picks.map((pick) => pick.resourceId)).toEqual(["ml"]);
    expect(result.picks[0].matchEvidence).toBe("标题匹配 · Machine Learning");
  });
});
