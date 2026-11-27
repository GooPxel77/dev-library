import { describe, expect, it } from "vitest";
import {
  askModel,
  generatePlannerRecommendation,
  getProviderConfig,
  parsePlannerCriteria,
  rankCorpus,
} from "../../lib/ai/planner";
import {
  DAILY_LIMIT,
  extractClientIp,
  reserveDailyQuota,
  type MemoryQuotaEntry,
} from "../../lib/ai/quota";
import type { PlannerCatalogRow } from "../../lib/data/planner-catalog";
import { POST } from "../../app/api/plan/route";

describe("planner criteria and provider config", () => {
  it("validates criteria bounds and defaults includeProjects to true", () => {
    expect(parsePlannerCriteria({ goal: "", difficulty: "all", language: "all", format: "all" })).toBeNull();
    expect(parsePlannerCriteria({ goal: "Python", difficulty: "beginner", language: "zh", format: "course" })).toEqual({
      goal: "Python",
      difficulty: "beginner",
      language: "zh",
      format: "course",
      includeProjects: true,
    });
    expect(
      parsePlannerCriteria({
        goal: "Python",
        difficulty: "all",
        language: "all",
        format: "all",
        includeProjects: false,
      })?.includeProjects,
    ).toBe(false);
  });

  it("normalizes versioned provider URLs and rejects insecure or incomplete configs", () => {
    expect(
      getProviderConfig({
        AI_API_URL: "https://provider.example/custom/v1/",
        AI_API_KEY: "secret",
        AI_MODEL: "model-a",
      } as unknown as NodeJS.ProcessEnv)?.url.toString(),
    ).toBe("https://provider.example/custom/v1/chat/completions");

    expect(
      getProviderConfig({
        AI_API_URL: "http://insecure.example/v1",
        AI_API_KEY: "secret",
        AI_MODEL: "model-a",
      } as unknown as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});

describe("BM25 ranking, retry recovery, and metadata enrichment", () => {
  it("ranks concise relevant projects above long noisy summaries", () => {
    const noisySummary = Array.from({ length: 120 }, () => "general automation platform workflow").join(" ") + " analytics";
    const rows: PlannerCatalogRow[] = [
      {
        id: "noisy",
        title: "Enterprise Suite",
        url: "https://github.com/example/noisy",
        type: "app",
        collection: "github",
        language: "en",
        category: "DevTools",
        tags: [],
        quality: "standard",
        source: "GitHub",
        project: {
          title: "Enterprise Suite",
          url: "https://github.com/example/noisy",
          summary: noisySummary,
          capabilities: ["workflow"],
          stack: ["Java"],
          available: true,
        },
      },
      {
        id: "concise",
        title: "CSV Invoice Aggregator",
        url: "https://github.com/example/csv-agg",
        type: "app",
        collection: "github",
        language: "en",
        category: "Data",
        tags: [],
        quality: "standard",
        source: "GitHub",
        project: {
          title: "CSV Invoice Aggregator",
          url: "https://github.com/example/csv-agg",
          summary: "Summarize monthly sales CSV files and export product revenue charts.",
          whySaved: "Exact CSV sales aggregation and chart generation pipeline.",
          bestFor: ["Developers building sales CSV reports"],
          capabilities: ["csv", "sales-report", "charts"],
          stack: ["Python"],
          available: true,
        },
      },
    ];

    const hits = rankCorpus(rows, ["csv sales report", "charts", "workflow"], ["sales"], (row) => [
      { text: row.project!.title, weight: 3.0 },
      { text: [...row.project!.capabilities, ...row.project!.stack].join(" "), weight: 2.5 },
      { text: [row.project!.whySaved || "", ...(row.project!.bestFor || [])].join(" "), weight: 1.8 },
      { text: row.project!.summary, weight: 1.0 },
    ]);

    expect(hits.map((h) => h.row.id)).toEqual(["concise", "noisy"]);
  });

  it("retries once on 503, parses prose-wrapped JSON, and forwards whySaved/bestFor/domain", async () => {
    let attempts = 0;
    let seenWhySaved = "";
    let seenBestFor: string[] = [];

    const mockFetch: typeof fetch = async (_url, init) => {
      attempts++;
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.messages[1].content);

      if (!input.candidates) {
        if (attempts === 1) {
          return new Response(null, { status: 503 });
        }
        return Response.json({
          choices: [
            {
              message: {
                content: 'Search plan:\n{"terms":["python sales"],"projectTerms":["csv sales charts"]}\nEnd.',
              },
            },
          ],
        });
      }

      seenWhySaved = input.projectCandidates[0]?.whySaved ?? "";
      seenBestFor = input.projectCandidates[0]?.bestFor ?? [];
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                picks: [{ id: "m1", reason: "Covers Python sales basics", fit: "direct" }],
                projects: [{ id: "p1", use: "apply", reason: "CSV sales pipeline", step: "Run on sample CSV" }],
                plan: "Start with Python Sales Course and CSV Sales Charts.",
              }),
            },
          },
        ],
      });
    };

    const provider = getProviderConfig({
      AI_API_URL: "https://provider.example/v1",
      AI_API_KEY: "fixture",
      AI_MODEL: "test-model",
    } as unknown as NodeJS.ProcessEnv)!;

    const catalog: PlannerCatalogRow[] = [
      {
        id: "m1",
        title: "Python Sales Course",
        url: "https://www.learn.example.com/py",
        type: "course",
        collection: "courses",
        language: "en",
        category: "Python",
        tags: ["sales"],
        quality: "standard",
        source: "free-programming-books",
      },
      {
        id: "p1",
        title: "CSV Sales Charts",
        url: "https://github.com/example/charts",
        type: "app",
        collection: "github",
        language: "en",
        category: "Data",
        tags: [],
        quality: "standard",
        source: "GitHub",
        project: {
          title: "CSV Sales Charts",
          url: "https://github.com/example/charts",
          summary: "Sales CSV reporting and charts",
          whySaved: "Built for monthly sales CSV charts",
          bestFor: ["Analysts summarizing monthly sales"],
          capabilities: ["csv", "charts"],
          stack: ["Python"],
          available: true,
        },
      },
    ];

    const result = await generatePlannerRecommendation(
      provider,
      { goal: "Python sales", difficulty: "all", language: "all", format: "all", includeProjects: true },
      catalog,
      mockFetch,
    );

    expect(attempts).toBe(3);
    expect(seenWhySaved).toBe("Built for monthly sales CSV charts");
    expect(seenBestFor).toEqual(["Analysts summarizing monthly sales"]);
    expect(result.recommendations[0]).toEqual({
      id: "m1",
      title: "Python Sales Course",
      reason: "Covers Python sales basics",
      fit: "direct",
      url: "https://www.learn.example.com/py",
      domain: "learn.example.com",
      type: "course",
      language: "en",
    });
    expect(result.projects[0].id).toBe("p1");
  });

  it("askModel fails after exhausting 2 attempts", async () => {
    const provider = getProviderConfig({
      AI_API_URL: "https://provider.example/v1",
      AI_API_KEY: "fixture",
      AI_MODEL: "test-model",
    } as unknown as NodeJS.ProcessEnv)!;

    let calls = 0;
    await expect(
      askModel(provider, "sys", { goal: "x" }, 100, async () => {
        calls++;
        return new Response(null, { status: 503 });
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });
});

describe("daily IP quota and /api/plan route validation", () => {
  it("enforces daily limit of 10 in memory fallback and extracts forwarded client IP", async () => {
    const store = new Map<string, MemoryQuotaEntry>();
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(extractClientIp(headers)).toBe("203.0.113.5");

    const now = new Date("2026-11-27T12:00:00Z");
    for (let i = 0; i < DAILY_LIMIT; i++) {
      const slot = await reserveDailyQuota("203.0.113.5", {
        env: {} as NodeJS.ProcessEnv,
        now,
        memoryStore: store,
      });
      expect(slot.allowed).toBe(true);
      expect(slot.remaining).toBe(DAILY_LIMIT - i - 1);
    }

    const denied = await reserveDailyQuota("203.0.113.5", {
      env: {} as NodeJS.ProcessEnv,
      now,
      memoryStore: store,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it("uses atomic Upstash Redis pipeline when REST credentials are configured", async () => {
    let seenUrl = "";
    let seenCommands: unknown[] = [];

    const slot = await reserveDailyQuota("198.51.100.7", {
      env: {
        UPSTASH_REDIS_REST_URL: "https://redis.example.upstash.io/",
        UPSTASH_REDIS_REST_TOKEN: "tok",
      } as unknown as NodeJS.ProcessEnv,
      now: new Date("2026-11-27T12:00:00Z"),
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        seenCommands = JSON.parse(String(init?.body));
        return Response.json([{ result: 3 }, { result: 1 }]);
      },
    });

    expect(seenUrl).toBe("https://redis.example.upstash.io/pipeline");
    expect((seenCommands[0] as string[])[0]).toBe("INCR");
    expect((seenCommands[1] as string[])[0]).toBe("EXPIREAT");
    expect(slot.allowed).toBe(true);
    expect(slot.remaining).toBe(7);
  });

  it("rejects wrong origin (403), non-json content-type (415), and invalid body (400)", async () => {
    const res403 = await POST(
      new Request("http://localhost:3000/api/plan", {
        method: "POST",
        headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(res403.status).toBe(403);

    const res415 = await POST(
      new Request("http://localhost:3000/api/plan", {
        method: "POST",
        headers: { Origin: "http://localhost:3000", "Content-Type": "text/plain" },
        body: "hello",
      }),
    );
    expect(res415.status).toBe(415);

    const prevUrl = process.env.AI_API_URL;
    const prevKey = process.env.AI_API_KEY;
    const prevModel = process.env.AI_MODEL;
    process.env.AI_API_URL = "https://provider.example/v1";
    process.env.AI_API_KEY = "fixture";
    process.env.AI_MODEL = "test-model";
    try {
      const res400 = await POST(
        new Request("http://localhost:3000/api/plan", {
          method: "POST",
          headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
          body: JSON.stringify({ goal: "", difficulty: "all", language: "all", format: "all" }),
        }),
      );
      expect(res400.status).toBe(400);
    } finally {
      process.env.AI_API_URL = prevUrl;
      process.env.AI_API_KEY = prevKey;
      process.env.AI_MODEL = prevModel;
    }
  });
});
