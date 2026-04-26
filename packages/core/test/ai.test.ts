import { describe, expect, test, mock } from "bun:test";
import { createAIService } from "../src/ai";
import { SQL } from "bun";

const originalFetch = globalThis.fetch;

describe("AI Service", () => {
  test("gemini provider calls correct url", async () => {
    globalThis.fetch = mock(async (url, options) => {
      expect(url.toString()).toContain("generativelanguage.googleapis.com");
      expect(url.toString()).toContain("gemini-2.0-flash");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }));
    }) as any;
    
    const svc = createAIService({
      source: "static",
      provider: "gemini",
      apiKey: "test-key"
    });
    
    const res = await svc.test();
    expect(res.ok).toBe(true);
    
    globalThis.fetch = originalFetch;
  });

  test("openai provider calls correct url", async () => {
    globalThis.fetch = mock(async (url, options) => {
      expect(url.toString()).toBe("https://api.openai.com/v1/chat/completions");
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    }) as any;
    
    const svc = createAIService({
      source: "static",
      provider: "openai",
      apiKey: "test-key"
    });
    
    const res = await svc.test();
    expect(res.ok).toBe(true);
    
    globalThis.fetch = originalFetch;
  });

  test("db config resolves", async () => {
    globalThis.fetch = mock(async (url, options) => {
      expect(url.toString()).toContain("http://local:11434");
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    }) as any;

    const sql = new SQL("sqlite://:memory:");
    await sql.connect();
    await sql.unsafe(`CREATE TABLE settings (key TEXT, value TEXT)`);
    await sql.unsafe(`INSERT INTO settings VALUES ('ai_provider', 'custom'), ('ai_api_key', 'none'), ('ai_api_base_url', 'http://local:11434')`);
    
    const svc = createAIService({
      source: "db",
      table: "settings",
      keyColumn: "key",
      valueColumn: "value"
    }, sql);

    const res = await svc.test();
    expect(res.ok).toBe(true);

    await sql.close();
    globalThis.fetch = originalFetch;
  });
});
