import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { rateLimit } from "../src/rate-limit";

describe("rateLimit", () => {
  test("blocks requests over limit", async () => {
    const app = new Hono();
    // 2 requests per second
    app.use("/api/*", rateLimit({ limit: 2, windowMs: 1000 }));
    app.get("/api/test", (c) => c.text("ok"));

    const r1 = await app.request("/api/test");
    expect(r1.status).toBe(200);
    
    const r2 = await app.request("/api/test");
    expect(r2.status).toBe(200);

    const r3 = await app.request("/api/test");
    expect(r3.status).toBe(429);
    
    const data = await r3.json() as any;
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Too many requests");
  });
});
