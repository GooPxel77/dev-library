import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";

const origin = "https://www.205022.xyz";
const criteria = { goal: "Python", format: "all", difficulty: "beginner", language: "zh", titles: ["Python 入门"] };
const bindings = {
  SITE_ORIGIN: origin, AI_MODEL: "custom-model", AI_API_URL: "https://provider.example/custom/chat/completions", AI_API_KEY: "fixture",
};
let calls = 0;
const runtime = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL("./worker.mjs", import.meta.url)),
  compatibilityDate: "2026-03-01",
  durableObjects: { QUOTAS: { className: "DailyQuota", useSQLite: true } },
  bindings,
  outboundService: async request => {
    calls++;
    assert.equal(request.url, bindings.AI_API_URL);
    assert.equal(request.headers.get("Authorization"), `Bearer ${bindings.AI_API_KEY}`);
    const body = await request.json();
    assert.equal(body.model, bindings.AI_MODEL);
    if (body.messages[1].content.includes("test-failure")) return new Response(null, { status: 503 });
    return Response.json({ choices: [{ message: { content: "第一天：完成入门练习。" } }] });
  },
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
  assert.equal(calls, 10);
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
  assert.equal((await post(ip, { ...criteria, titles: [] })).status, 400);
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
    outboundService: async () => Response.json({ choices: [{ message: { content: "Day one" } }] }),
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
