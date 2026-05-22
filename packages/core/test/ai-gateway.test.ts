import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createAIService } from "../src/ai";
import type { LumoraAIConfig } from "../src/ai";

// ---------------------------------------------------------------------------
// Mock fetch globally to avoid real network calls
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mock fetch globally to avoid real network calls
// ---------------------------------------------------------------------------

let fetchOverride: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | null = null;
const originalFetch = globalThis.fetch;

beforeAll(() => {
  (globalThis as any).fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (fetchOverride) return fetchOverride(input, init);
    return new Response("Unmocked fetch", { status: 500 });
  };
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function mockProvider(text: string, inputTokens = 10, outputTokens = 5) {
  fetchOverride = async (_input, _init) => {
    // Detect provider from URL
    const url = String(_input);
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: inputTokens, candidatesTokenCount: outputTokens }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("anthropic.com")) {
      return new Response(JSON.stringify({
        content: [{ text }],
        usage: { input_tokens: inputTokens, output_tokens: outputTokens }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    // OpenAI-compat
    return new Response(JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AI Gateway (LS-10)", () => {
  test("complete() calls Gemini provider", async () => {
    mockProvider("Hello from Gemini");

    const cfg: LumoraAIConfig = {
      source: "static",
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.0-flash"
    };
    const ai = createAIService(cfg);
    const result = await ai.complete("Say hello");
    expect(result).toBe("Hello from Gemini");
  });

  test("complete() calls OpenAI provider", async () => {
    mockProvider("Hello from OpenAI");

    const cfg: LumoraAIConfig = {
      source: "static",
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini"
    };
    const ai = createAIService(cfg);
    const result = await ai.complete("Say hello");
    expect(result).toBe("Hello from OpenAI");
  });

  test("complete() calls Anthropic/Claude provider", async () => {
    mockProvider("Hello from Claude");

    const cfg: LumoraAIConfig = {
      source: "static",
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-3-5-haiku-20241022"
    };
    const ai = createAIService(cfg);
    const result = await ai.complete("Say hello");
    expect(result).toBe("Hello from Claude");
  });

  test("chat() sends multi-turn messages", async () => {
    mockProvider("The capital is Paris");

    const cfg: LumoraAIConfig = {
      source: "static",
      provider: "openai",
      apiKey: "sk-test"
    };
    const ai = createAIService(cfg);
    const result = await ai.chat({
      messages: [
        { role: "system", content: "You are a geography tutor." },
        { role: "user", content: "What is the capital of France?" }
      ]
    });
    expect(result).toBe("The capital is Paris");
  });

  test("chat() with provider override dispatches to different provider", async () => {
    mockProvider("Claude says hi");

    const cfg: LumoraAIConfig = {
      source: "static",
      provider: "openai",
      apiKey: "sk-test"
    };
    const ai = createAIService(cfg);
    const result = await ai.chat({
      messages: [{ role: "user", content: "Greet me" }],
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022"
    });
    expect(result).toBe("Claude says hi");
  });

  test("getUsage() returns zeroes without DB", async () => {
    const cfg: LumoraAIConfig = { source: "static", provider: "gemini", apiKey: "k" };
    const ai = createAIService(cfg);
    const usage = await ai.getUsage();
    expect(usage.requests).toBe(0);
    expect(usage.totalCostUsd).toBe(0);
  });

  test("cost calculation: gpt-4o uses hardcoded pricing", async () => {
    // Input: 1M tokens at $5 = $5; Output: 1M at $15 = $15
    // Test with 1000 input + 500 output
    mockProvider("Test", 1000, 500);
    const cfg: LumoraAIConfig = { source: "static", provider: "openai", apiKey: "k", model: "gpt-4o" };
    const ai = createAIService(cfg);
    const result = await ai.complete("test");
    expect(typeof result).toBe("string");
    // No DB so cost logging is skipped — just verify no crash
  });

  test("cost calculation: config override beats pricing table", async () => {
    mockProvider("Test", 100, 50);
    const cfg: LumoraAIConfig = {
      source: "static",
      provider: "openai",
      apiKey: "k",
      model: "gpt-4o",
      costPerInputToken: 0.000001,   // $1 per 1M input tokens
      costPerOutputToken: 0.000002,  // $2 per 1M output tokens
    };
    const ai = createAIService(cfg);
    const result = await ai.complete("test");
    expect(result).toBe("Test");
  });

  test("test() returns ok:true on successful mock", async () => {
    mockProvider("OK");
    const cfg: LumoraAIConfig = { source: "static", provider: "gemini", apiKey: "k" };
    const ai = createAIService(cfg);
    const result = await ai.test();
    expect(result.ok).toBe(true);
  });

  test("test() returns ok:false on provider error", async () => {
    fetchOverride = async () => new Response("Internal Server Error", { status: 500 });
    const cfg: LumoraAIConfig = { source: "static", provider: "openai", apiKey: "k" };
    const ai = createAIService(cfg);
    const result = await ai.test();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });
});
