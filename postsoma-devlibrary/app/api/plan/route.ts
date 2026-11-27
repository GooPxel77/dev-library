import {
  eligibleResources,
  generatePlannerRecommendation,
  getProviderConfig,
  NO_MATCH_RESULT,
  parsePlannerCriteria,
} from "../../../lib/ai/planner";
import { extractClientIp, reserveDailyQuota } from "../../../lib/ai/quota";
import { getPlannerCatalog } from "../../../lib/data/planner-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function reply(data: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return Response.json(data, {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;

  const allowedOrigins = new Set<string>([new URL(request.url).origin]);
  const forwardedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.trim();
  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(request.url).protocol.replace(/:$/, "");

  if (forwardedHost) {
    allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl && URL.canParse(siteUrl)) {
    allowedOrigins.add(new URL(siteUrl).origin);
  }
  return allowedOrigins.has(origin);
}

async function readJsonBody(request: Request, maxBytes = 8192): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const bytes = new Uint8Array(maxBytes);
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > bytes.length) {
      await reader.cancel();
      return null;
    }
    bytes.set(value, length);
    length += value.length;
  }

  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return reply({}, 403);
  }
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    return reply({}, 415);
  }

  const provider = getProviderConfig();
  if (!provider) {
    return reply({}, 503);
  }

  const body = await readJsonBody(request).catch(() => null);
  const criteria = parsePlannerCriteria(body);
  if (!criteria) {
    return reply({ error: "invalid_input" }, 400);
  }

  let catalog;
  try {
    catalog = await getPlannerCatalog();
    if (!Array.isArray(catalog) || !catalog.length) {
      throw new Error("Empty catalog");
    }
  } catch {
    return reply({ error: "catalog_unavailable" }, 503);
  }

  const eligible = eligibleResources(catalog, criteria);
  if (!eligible.length) {
    return reply(NO_MATCH_RESULT);
  }

  let quota;
  try {
    quota = await reserveDailyQuota(extractClientIp(request.headers));
  } catch {
    return reply({ error: "quota_unavailable" }, 503);
  }

  const { remaining, resetAt } = quota;
  if (!quota.allowed) {
    const retryAfter = String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)));
    return reply({ error: "daily_limit", remaining, resetAt }, 429, {
      "Retry-After": retryAfter,
    });
  }

  try {
    const result = await generatePlannerRecommendation(provider, criteria, eligible);
    return reply({ ...result, remaining, resetAt });
  } catch {
    return reply({ error: "model_unavailable", remaining, resetAt }, 502);
  }
}
