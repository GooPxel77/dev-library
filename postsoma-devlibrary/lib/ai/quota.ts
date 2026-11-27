import { createHash } from "node:crypto";

export const DAILY_LIMIT = 10;

export interface QuotaReservation {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface MemoryQuotaEntry {
  resetAt: number;
  used: number;
}

export interface ReserveQuotaOptions {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  fetchImpl?: typeof fetch;
  memoryStore?: Map<string, MemoryQuotaEntry>;
}

const defaultMemoryStore = new Map<string, MemoryQuotaEntry>();

export function extractClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const cfIp = headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;
  return "127.0.0.1";
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export async function reserveDailyQuota(
  ip: string,
  options: ReserveQuotaOptions = {},
): Promise<QuotaReservation> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const resetAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const dayKey = now.toISOString().slice(0, 10);
  const ipHash = hashIp(ip);

  const redisUrl = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)?.trim().replace(/\/+$/, "");
  const redisToken = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)?.trim();

  if (redisUrl && redisToken) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const key = `planner:quota:${dayKey}:${ipHash}`;
    const response = await fetchImpl(`${redisUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIREAT", key, Math.floor(resetAt / 1000)],
      ]),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error("Quota backend unavailable");
    }
    const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const count = Number(payload?.[0]?.result);
    if (!Number.isFinite(count) || count < 1) {
      throw new Error("Invalid quota counter response");
    }
    return {
      allowed: count <= DAILY_LIMIT,
      remaining: Math.max(0, DAILY_LIMIT - count),
      resetAt,
    };
  }

  const store = options.memoryStore ?? defaultMemoryStore;
  const nowMs = now.getTime();
  for (const [k, entry] of store.entries()) {
    if (entry.resetAt <= nowMs) store.delete(k);
  }

  const existing = store.get(ipHash);
  const currentUsed = existing && existing.resetAt === resetAt ? existing.used : 0;
  if (currentUsed >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0, resetAt };
  }

  const nextUsed = currentUsed + 1;
  store.set(ipHash, { resetAt, used: nextUsed });
  return {
    allowed: true,
    remaining: DAILY_LIMIT - nextUsed,
    resetAt,
  };
}
