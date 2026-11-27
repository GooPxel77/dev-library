import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";

const origin = "https://www.205022.xyz";
const criteria = { goal: "Python", format: "all", difficulty: "beginner", language: "zh" };
const bindings = {
  SITE_ORIGIN: origin, AI_MODEL: "custom-model", AI_API_URL: "https://provider.example/custom/v1/", AI_API_KEY: "fixture",
};
const catalog = [
  { id: "a", title: "Python reference", url: "https://docs.example.org/python", language: "zh", type: "book" },
  { id: "b", title: "Python 入门", url: "https://learn.example.com/python", language: "zh", type: "tutorial" },
  { id: "c", title: "Python advanced", url: "https://courses.example.edu/py", language: "en", type: "course", difficulty: "advanced" },
];
const project = {
  title: "CSV charts",
  summary: "sales reporting",
  whySaved: "Turn raw monthly sales CSV files into product charts.",
  bestFor: ["Analysts building monthly sales summaries"],
  capabilities: ["charts"],
  stack: ["Python"],
  url: "https://github.com/example/charts",
  available: true,
};
catalog.push(
  { id: "repo", title: "CSV charts", type: "app", language: "en", collection: "github", project },
  { id: "old", title: "Retired CSV charts", type: "app", language: "en", collection: "github", project: { ...project, available: false } },
);
let calls = 0;
async function serve(request) {
  if (request.url === origin + "/data/recommendations.json") return Response.json(catalog);
  calls++;
  assert.equal(request.url, "https://provider.example/custom/v1/chat/completions");
  assert.equal(request.headers.get("Authorization"), `Bearer ${bindings.AI_API_KEY}`);
  const body = await request.json();
  assert.equal(body.model, bindings.AI_MODEL);
  const input = JSON.parse(body.messages[1].content);
  if (input.goal === "test-failure") return new Response(null, { status: 503 });
  let result = { terms: [input.goal === "unrelated" ? "no match" : "python"] };
  if (input.goal === "monthly totals") result = { terms: ["Python for sales reporting"], projectTerms: ["monthly revenue charts"] };
  if (input.candidates) {
    const onlyProjects = input.criteria.format === "course";
    assert.deepEqual(input.candidates.map(row => row.id), onlyProjects ? [] : ["a", "b"]);
    assert.deepEqual(input.projectCandidates.map(row => row.id), input.criteria.includeProjects ? ["repo"] : []);
    if (input.projectCandidates.length) {
      assert.equal(input.projectCandidates[0].whySaved, project.whySaved);
      assert.deepEqual(input.projectCandidates[0].bestFor, project.bestFor);
    }
    const projects = input.projectCandidates.length ? [{ id: input.criteria.goal === "bad project" ? "b" : "repo", use: "apply", reason: "charts from CSV", step: "Group sample sales by month" }] : [];
    const id = input.criteria.goal === "unknown id" ? "fabricated" : "b";
    result = { projects, picks: onlyProjects ? [] : [{ id, reason: "Learning basics", fit: "direct" }], plan: "Day one" };
  }
  return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
}
const runtime = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL("./worker.mjs", import.meta.url)),
  compatibilityDate: "2026-03-01",
  durableObjects: { QUOTAS: { className: "DailyQuota", useSQLite: true } },
  bindings,
  outboundService: serve,
});
after(() => runtime.dispose());

function post(ip, body = criteria, extraHeaders = {}) {
  return runtime.dispatchFetch("https://planner.test/plan", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": ip, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

test("concurrent calls share ten slots and the next IP has its own allowance", async () => {
  const batch = await Promise.all(Array.from({ length: 15 }, (_, i) =>
    post("192.0.2.1", criteria, { "X-Forwarded-For": `192.0.2.${i + 10}` })));
  assert.equal(batch.filter(r => r.status === 200).length, 10);
  assert.equal(batch.filter(r => r.status === 429).length, 5);
  assert.equal(calls, 20);
  const denied = batch.find(r => r.status === 429);
  assert.ok(Number(denied.headers.get("Retry-After")) > 0);
  const { remaining, resetAt } = await denied.json();
  assert.equal(remaining, 0);
  assert.equal(new Date(resetAt).toISOString().slice(11), "00:00:00.000Z");
  const next = await post("192.0.2.2");
  assert.equal((await next.json()).remaining, 9);
});

test("rejected input and preflight do not spend a slot; attempted model calls do", async () => {
  const ip = "192.0.2.3";
  assert.equal((await post(ip, criteria, { Origin: "https://other.test" })).status, 403);
  assert.equal((await post(ip, { ...criteria, goal: "" })).status, 400);
  assert.equal((await post(ip, { ...criteria, goal: "a".repeat(9000) })).status, 400);
  const preflight = await runtime.dispatchFetch("https://planner.test/plan", { method: "OPTIONS", headers: { Origin: origin } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
  const failed = await post(ip, { ...criteria, goal: "test-failure" });
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).remaining, 9);
  const success = await post(ip);
  assert.equal((await success.json()).remaining, 8);
});

test("a full counter from yesterday allows today's first model call", async () => {
  const source = await readFile(new URL("./worker.mjs", import.meta.url), "utf8");
  const local = new Miniflare({
    compatibilityDate: "2026-03-01",
    modules: [
      { type: "ESModule", path: "fixture.mjs", contents: `
        import planner, { DailyQuota } from "./worker.mjs";
        export class FixtureQuota extends DailyQuota {
          expireDay() { this.ctx.storage.sql.exec("UPDATE quota SET reset = 0"); }
        }
        export default {
          async fetch(request, env) {
            if (new URL(request.url).pathname === "/advance-day") {
              const counter = env.QUOTAS.get(env.QUOTAS.idFromName("192.0.2.9"));
              await counter.expireDay();
              return new Response(null);
            }
            if (new URL(request.url).searchParams.has("unconfigured")) {
              return planner.fetch(request, { ...env, AI_API_KEY: "" });
            }
            return planner.fetch(request, env);
          }
        };` },
      { type: "ESModule", path: "worker.mjs", contents: source },
    ],
    durableObjects: { QUOTAS: { className: "FixtureQuota", useSQLite: true } },
    bindings,
    outboundService: serve,
  });
  const call = (query = "") => local.dispatchFetch(`https://planner.test/plan${query}`, {
    method: "POST", headers: { Origin: origin, "CF-Connecting-IP": "192.0.2.9", "Content-Type": "application/json" },
    body: JSON.stringify(criteria),
  });
  try {
    assert.equal((await call("?unconfigured")).status, 503);
    for (let i = 0; i < 10; i++) assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 429);
    await local.dispatchFetch("https://planner.test/advance-day");
    const { remaining, plan } = await (await call()).json();
    assert.equal(remaining, 9);
    assert.equal(plan, "Day one");
  } finally {
    await local.dispose();
  }
});

test("model selects catalog records independently; fabricated ids and unrelated goals yield no links", async () => {
  const ip = "192.0.2.21";
  const response = await post(ip, { ...criteria, titles: ["fabricated by client"] });
  assert.deepEqual((await response.json()).recommendations, [
    {
      id: "b",
      title: "Python 入门",
      reason: "Learning basics",
      fit: "direct",
      url: "https://learn.example.com/python",
      domain: "learn.example.com",
      type: "tutorial",
      language: "zh",
    },
  ]);
  assert.equal((await post(ip, { ...criteria, goal: "unknown id" })).status, 502);
  assert.deepEqual((await (await post(ip, { ...criteria, goal: "unrelated" })).json()).recommendations, []);
});

test("curated projects supplement strict material filters and can be excluded", async () => {
  const ip = "192.0.2.24";
  const projectOnly = await (await post(ip, { ...criteria, format: "course" })).json();
  assert.equal(projectOnly.recommendations.length, 0);
  assert.equal(projectOnly.projects.length, 1);
  assert.equal(projectOnly.projects[0].url, project.url);
  assert.equal(projectOnly.remaining, 9);
  const compound = await (await post(ip, { ...criteria, goal: "monthly totals" })).json();
  assert.equal(compound.projects[0].id, "repo");
  assert.equal(compound.recommendations[0].id, "b");
  const disabled = await (await post(ip, { ...criteria, includeProjects: false })).json();
  assert.deepEqual(disabled.projects, []);
  assert.equal(disabled.recommendations.length, 1);
  assert.equal((await post(ip, { ...criteria, goal: "bad project" })).status, 502);
});

test("BM25 ranks concise relevant projects above noisy long summaries, caches catalog, and retries transient failures", async () => {
  const bm25Origin = "https://bm25.example";
  let catalogFetches = 0;
  let modelStep1Attempts = 0;
  let observedOrder = [];

  const noisySummary = Array.from({ length: 120 }, () => "general automation platform workflow").join(" ") + " analytics";
  const bm25Catalog = [
    { id: "m1", title: "Python Sales Tutorial", url: "https://www.tutorial.example/py", language: "en", type: "tutorial" },
    {
      id: "noisy",
      title: "Enterprise Suite",
      type: "app",
      language: "en",
      collection: "github",
      project: {
        title: "Enterprise Suite",
        summary: noisySummary,
        capabilities: ["workflow"],
        stack: ["Java"],
        url: "https://github.com/example/noisy",
        available: true,
      },
    },
    {
      id: "concise",
      title: "CSV Invoice Aggregator",
      type: "app",
      language: "en",
      collection: "github",
      project: {
        title: "CSV Invoice Aggregator",
        summary: "Summarize monthly sales CSV files and export product revenue charts.",
        whySaved: "Exact CSV sales aggregation and chart generation pipeline.",
        bestFor: ["Developers building sales CSV reports"],
        capabilities: ["csv", "sales-report", "charts"],
        stack: ["Python"],
        url: "https://github.com/example/csv-agg",
        available: true,
      },
    },
  ];

  const local = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("./worker.mjs", import.meta.url)),
    compatibilityDate: "2026-03-01",
    durableObjects: { QUOTAS: { className: "DailyQuota", useSQLite: true } },
    bindings: { ...bindings, SITE_ORIGIN: bm25Origin },
    async outboundService(request) {
      if (request.url === bm25Origin + "/data/recommendations.json") {
        catalogFetches++;
        return Response.json(bm25Catalog);
      }
      const body = await request.json();
      const input = JSON.parse(body.messages[1].content);
      if (!input.candidates) {
        modelStep1Attempts++;
        if (modelStep1Attempts === 1) return new Response(null, { status: 503 });
        return Response.json({
          choices: [{
            message: {
              content: 'Here is the query plan:\n{"terms":["python sales"],"projectTerms":["csv sales report","charts","workflow"]}\nDone.',
            },
          }],
        });
      }
      observedOrder = input.projectCandidates.map(row => row.id);
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              picks: [{ id: "m1", reason: "Covers Python sales basics", fit: "direct" }],
              projects: [{ id: "concise", use: "apply", reason: "Matches CSV sales aggregation", step: "Run on sample sales CSV" }],
              plan: "Use Python Sales Tutorial and CSV Invoice Aggregator.",
            }),
          },
        }],
      });
    },
  });

  const call = () => local.dispatchFetch("https://planner.test/plan", {
    method: "POST",
    headers: { Origin: bm25Origin, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.88" },
    body: JSON.stringify({ goal: "sales CSV charts", format: "all", difficulty: "all", language: "all" }),
  });

  try {
    const first = await call();
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.recommendations[0].domain, "tutorial.example");
    assert.equal(firstBody.projects[0].id, "concise");
    assert.deepEqual(observedOrder, ["concise", "noisy"]);
    assert.equal(modelStep1Attempts, 2);

    const second = await call();
    assert.equal(second.status, 200);
    assert.equal(catalogFetches, 1);
  } finally {
    await local.dispose();
  }
});
