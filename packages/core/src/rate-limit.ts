import type { Context, MiddlewareHandler } from "hono";

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private counters = new Map<string, { count: number; resetAt: number }>();
  private opsSincePrune = 0;

  private pruneExpired(now: number): void {
    for (const [k, v] of this.counters.entries()) {
      if (now > v.resetAt) {
        this.counters.delete(k);
      }
    }
  }

  async increment(key: string, windowMs: number) {
    const now = Date.now();
    this.opsSincePrune++;
    if (this.opsSincePrune >= 250 || this.counters.size > 2000) {
      this.opsSincePrune = 0;
      this.pruneExpired(now);
    }

    const entry = this.counters.get(key);
    if (!entry || now > entry.resetAt) {
      const resetAt = now + windowMs;
      this.counters.set(key, { count: 1, resetAt });
      return { count: 1, resetAt };
    } else {
      entry.count++;
      return { count: entry.count, resetAt: entry.resetAt };
    }
  }
}

export class PostgresRateLimitStore implements RateLimitStore {
  private initPromise: Promise<void>;

  constructor(private sql: import("bun").SQL, private schema?: string) {
    this.initPromise = this.init().catch(err => {
      console.error("[lumora:rate-limit] Error initializing table:", err);
    });
  }

  private async init() {
    const safeSchema = this.schema?.replace(/[`"]/g, "");
    const table = safeSchema ? `"${safeSchema}"."lumora_rate_limits"` : `"lumora_rate_limits"`;
    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${table} (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset BIGINT NOT NULL
      )
    `);
  }

  async increment(key: string, windowMs: number) {
    await this.initPromise;
    const safeSchema = this.schema?.replace(/[`"]/g, "");
    const table = safeSchema ? `"${safeSchema}"."lumora_rate_limits"` : `"lumora_rate_limits"`;
    const safeKey = key.replace(/'/g, "''");
    const now = Date.now();
    const reset = now + windowMs;
    const query = `
      INSERT INTO ${table} (key, count, reset)
      VALUES ('${safeKey}', 1, ${reset})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN ${table}.reset < ${now} THEN 1 ELSE ${table}.count + 1 END,
        reset = CASE WHEN ${table}.reset < ${now} THEN ${reset} ELSE ${table}.reset END
      RETURNING count, reset
    `;
    const rows = await this.sql.unsafe<{ count: number | string; reset: number | string }[]>(query);
    const row = rows[0] ?? { count: 1, reset };
    return { count: Number(row.count), resetAt: Number(row.reset) };
  }
}

export interface RateLimitOptions {
  /** Maximum number of requests per window. */
  limit: number;
  /** Time window in milliseconds. */
  windowMs: number;
  /** Custom key extraction function. */
  keyFn?: (c: Context) => string;
  store?: RateLimitStore;
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const { limit, windowMs, keyFn } = opts;
  const store = opts.store ?? new MemoryRateLimitStore();

  return async function rateLimitMiddleware(c, next) {
    const key = keyFn
      ? keyFn(c)
      : (c.req.header("x-forwarded-for") ??
         c.req.header("cf-connecting-ip") ??
         "::1");

    const entry = await store.increment(key, windowMs);
    const remaining = Math.max(0, limit - entry.count);
    const resetSeconds = Math.ceil(entry.resetAt / 1000);

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(resetSeconds));

    if (entry.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json({ ok: false, error: "Too many requests" }, 429);
    }

    await next();
  };
}
