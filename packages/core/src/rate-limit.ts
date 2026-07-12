import type { Context, MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  /** Maximum number of requests per window. */
  limit: number;
  /** Time window in milliseconds. */
  windowMs: number;
  /**
   * Custom key extraction function. Defaults to x-forwarded-for,
   * then cf-connecting-ip, then "::1".
   *
   * NOTE: This implementation uses an in-memory counter and resets on
   * process restart. It is not safe for multi-process or clustered deployments.
   * For cluster-safe rate limiting, use a shared store (e.g., Redis or DB-backed).
   */
  keyFn?: (c: Context) => string;
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const { limit, windowMs, keyFn } = opts;
  const counters = new Map<string, { count: number; resetAt: number }>();

  return async function rateLimitMiddleware(c, next) {
    const key = keyFn
      ? keyFn(c)
      : (c.req.header("x-forwarded-for") ??
         c.req.header("cf-connecting-ip") ??
         "::1");

    const now = Date.now();
    const entry = counters.get(key);

    if (!entry || now > entry.resetAt) {
      counters.set(key, { count: 1, resetAt: now + windowMs });
    } else if (entry.count >= limit) {
      return c.json({ ok: false, error: "Too many requests" }, 429);
    } else {
      entry.count++;
    }

    await next();
  };
}
