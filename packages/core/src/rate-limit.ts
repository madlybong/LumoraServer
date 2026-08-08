import type { Context, MiddlewareHandler } from "hono";

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private counters = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowMs: number) {
    const now = Date.now();
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
  constructor(private sql: import("bun").SQL, private schema?: string) {
    this.init().catch(err => console.error("[lumora:rate-limit] Error initializing table:", err));
  }

  private async init() {
    const table = this.schema ? `"${this.schema}"."lumora_rate_limits"` : `"lumora_rate_limits"`;
    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${table} (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset BIGINT NOT NULL
      )
    `);
  }

  async increment(key: string, windowMs: number) {
    const table = this.schema ? `"${this.schema}"."lumora_rate_limits"` : `"lumora_rate_limits"`;
    const now = Date.now();
    const reset = now + windowMs;
    const query = `
      INSERT INTO ${table} (key, count, reset)
      VALUES ('${key}', 1, ${reset})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN ${table}.reset < ${now} THEN 1 ELSE ${table}.count + 1 END,
        reset = CASE WHEN ${table}.reset < ${now} THEN ${reset} ELSE ${table}.reset END
      RETURNING count, reset
    `;
    const rows = await this.sql.unsafe<{ count: number, reset: number }[]>(query);
    const row = rows[0] ?? { count: 1, reset: reset };
    return { count: row.count, resetAt: row.reset };
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

    if (entry.count > limit) {
      return c.json({ ok: false, error: "Too many requests" }, 429);
    }

    await next();
  };
}
