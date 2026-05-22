import type { SQL } from "bun";

// ---------------------------------------------------------------------------
// Provider configuration (LS-10)
// ---------------------------------------------------------------------------

export type AIProvider = "gemini" | "openai" | "anthropic" | "kilo" | "custom";

export interface AIStaticConfig {
  source: "static";
  provider: AIProvider;
  apiKey: string;
  /** Required for provider="custom" or "kilo". Defaults to provider canonical base URL. */
  baseUrl?: string;
  model?: string;
  /** Enable token usage tracking to `_ai_usage_log` table (requires database write access). */
  tokenTracking?: boolean;
  /** Override default cost-per-input-token (USD per token). */
  costPerInputToken?: number;
  /** Override default cost-per-output-token (USD per token). */
  costPerOutputToken?: number;
}

export interface AIDbConfig {
  source: "db";
  table: string;
  keyColumn?: string;   // default "key"
  valueColumn?: string; // default "value"
}

export type LumoraAIConfig = AIStaticConfig | AIDbConfig;

// ---------------------------------------------------------------------------
// Message & response types
// ---------------------------------------------------------------------------

export interface LumoraAIChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIUsageRecord {
  provider: AIProvider | string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  timestamp: string;
}

export interface AIUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  requests: number;
}

export interface LumoraAIService {
  /** Single-turn text completion (legacy). */
  complete(prompt: string): Promise<string>;
  /** Multi-turn chat with optional provider/model override. */
  chat(options: {
    messages: LumoraAIChatMessage[];
    provider?: AIProvider;
    model?: string;
    responseFormat?: "text" | "json";
  }): Promise<string>;
  /** Aggregate usage stats, optionally filtered by provider and/or since date. */
  getUsage(options?: {
    provider?: AIProvider;
    since?: Date;
  }): Promise<AIUsageSummary>;
  test(): Promise<{ ok: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Built-in pricing table (USD per token, updated per framework release)
// ---------------------------------------------------------------------------

type PriceEntry = { input: number; output: number };

const PRICE_TABLE: Record<string, PriceEntry> = {
  // Gemini
  "gemini-2.0-flash":        { input: 0.10 / 1_000_000,   output: 0.40 / 1_000_000 },
  "gemini-1.5-flash":        { input: 0.075 / 1_000_000,  output: 0.30 / 1_000_000 },
  "gemini-1.5-pro":          { input: 3.50 / 1_000_000,   output: 10.50 / 1_000_000 },
  // OpenAI
  "gpt-4o":                  { input: 5.00 / 1_000_000,   output: 15.00 / 1_000_000 },
  "gpt-4o-mini":             { input: 0.15 / 1_000_000,   output: 0.60 / 1_000_000 },
  "gpt-4-turbo":             { input: 10.00 / 1_000_000,  output: 30.00 / 1_000_000 },
  "gpt-3.5-turbo":           { input: 0.50 / 1_000_000,   output: 1.50 / 1_000_000 },
  // Anthropic
  "claude-3-5-sonnet-20241022": { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
  "claude-3-5-haiku-20241022":  { input: 0.80 / 1_000_000, output: 4.00 / 1_000_000 },
  "claude-3-opus-20240229":     { input: 15.00 / 1_000_000, output: 75.00 / 1_000_000 },
};

function getPrice(model: string, cfg: AIStaticConfig): PriceEntry {
  const base = PRICE_TABLE[model] ?? { input: 0, output: 0 };
  return {
    input: cfg.costPerInputToken ?? base.input,
    output: cfg.costPerOutputToken ?? base.output,
  };
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

async function resolveAIConfig(
  cfg: LumoraAIConfig,
  sql?: SQL
): Promise<AIStaticConfig> {
  if (cfg.source === "static") return cfg;

  if (!sql) throw new Error("DB-backed AI config requires a database connection.");

  const keyCol = cfg.keyColumn ?? "key";
  const valCol = cfg.valueColumn ?? "value";
  const rows = await sql.unsafe<{ key: string; value: string }[]>(
    `SELECT \`${keyCol}\` as key, \`${valCol}\` as value FROM \`${cfg.table}\`
     WHERE \`${keyCol}\` IN ('ai_provider','ai_api_key','ai_api_base_url','ai_model','ai_token_tracking')`
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    source: "static",
    provider: (m.ai_provider as AIProvider) ?? "gemini",
    apiKey: m.ai_api_key ?? "",
    baseUrl: m.ai_api_base_url || undefined,
    model: m.ai_model || undefined,
    tokenTracking: m.ai_token_tracking === "true",
  };
}

// ---------------------------------------------------------------------------
// Provider dispatch
// ---------------------------------------------------------------------------

interface ProviderResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callGemini(cfg: AIStaticConfig, messages: LumoraAIChatMessage[]): Promise<ProviderResponse> {
  const model = cfg.model ?? "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`;

  // Map messages to Gemini contents format
  const systemMsg = messages.find((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");
  const body: Record<string, unknown> = {
    contents: chatMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`);

  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  return { text, inputTokens, outputTokens };
}

async function callAnthropic(cfg: AIStaticConfig, messages: LumoraAIChatMessage[]): Promise<ProviderResponse> {
  const model = cfg.model ?? "claude-3-5-haiku-20241022";
  const baseUrl = cfg.baseUrl ?? "https://api.anthropic.com";
  const systemMsg = messages.find((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (systemMsg) body.system = systemMsg.content;

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);

  const data = await res.json() as {
    content?: { text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = data.content?.[0]?.text ?? "";
  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  return { text, inputTokens, outputTokens };
}

async function callOpenAICompat(cfg: AIStaticConfig, messages: LumoraAIChatMessage[], kiloMode = false): Promise<ProviderResponse> {
  const baseUrl = cfg.baseUrl ?? (kiloMode ? "https://api.kilo.codes" : "https://api.openai.com");
  const model = cfg.model ?? (kiloMode ? "claude-3-5-haiku" : "gpt-4o-mini");

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) throw new Error(`AI error: ${res.status} ${await res.text()}`);

  const data = await res.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? "";
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  return { text, inputTokens, outputTokens };
}

async function dispatch(cfg: AIStaticConfig, messages: LumoraAIChatMessage[]): Promise<ProviderResponse> {
  if (cfg.provider === "gemini") return callGemini(cfg, messages);
  if (cfg.provider === "anthropic") return callAnthropic(cfg, messages);
  if (cfg.provider === "kilo") return callOpenAICompat(cfg, messages, true);
  return callOpenAICompat(cfg, messages, false); // openai or custom
}

// ---------------------------------------------------------------------------
// Token usage logging helpers
// ---------------------------------------------------------------------------

async function ensureUsageTable(sql: SQL): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _ai_usage_log (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      input_cost_usd REAL NOT NULL DEFAULT 0,
      output_cost_usd REAL NOT NULL DEFAULT 0,
      total_cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
}

async function logUsage(
  sql: SQL,
  cfg: AIStaticConfig,
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  await ensureUsageTable(sql);
  const prices = getPrice(model, cfg);
  const inputCost = inputTokens * prices.input;
  const outputCost = outputTokens * prices.output;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await sql.unsafe(
    `INSERT INTO _ai_usage_log (id, provider, model, input_tokens, output_tokens, input_cost_usd, output_cost_usd, total_cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, cfg.provider, model, inputTokens, outputTokens, inputCost, outputCost, inputCost + outputCost, now]
  );
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createAIService(
  cfg: LumoraAIConfig,
  sql?: SQL
): LumoraAIService {
  return {
    // Legacy single-turn completion
    async complete(prompt: string) {
      const resolved = await resolveAIConfig(cfg, sql);
      const result = await dispatch(resolved, [{ role: "user", content: prompt }]);
      if (sql && resolved.tokenTracking) {
        const model = resolved.model ?? resolveDefaultModel(resolved.provider);
        await logUsage(sql, resolved, model, result.inputTokens, result.outputTokens);
      }
      return result.text;
    },

    // LS-10: Multi-turn chat
    async chat({ messages, provider: providerOverride, model: modelOverride, responseFormat }) {
      const resolved = await resolveAIConfig(cfg, sql);
      const override: AIStaticConfig = {
        ...resolved,
        ...(providerOverride ? { provider: providerOverride } : {}),
        ...(modelOverride ? { model: modelOverride } : {}),
      };

      let msgsToSend = messages;
      if (responseFormat === "json") {
        msgsToSend = [
          ...messages,
          { role: "system" as const, content: "Respond in valid JSON only. No markdown, no prose." }
        ];
      }

      const result = await dispatch(override, msgsToSend);

      if (sql && resolved.tokenTracking) {
        const model = override.model ?? resolveDefaultModel(override.provider);
        await logUsage(sql, override, model, result.inputTokens, result.outputTokens);
      }
      return result.text;
    },

    // LS-10: Usage stats
    async getUsage({ provider, since } = {}) {
      if (!sql) return { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, requests: 0 };

      await ensureUsageTable(sql);

      let query = `SELECT SUM(input_tokens) as ii, SUM(output_tokens) as oo, SUM(total_cost_usd) as cc, COUNT(*) as rr FROM _ai_usage_log WHERE 1=1`;
      const params: unknown[] = [];
      if (provider) { query += ` AND provider = ?`; params.push(provider); }
      if (since) { query += ` AND created_at >= ?`; params.push(since.toISOString()); }

      const rows = await sql.unsafe<{ ii?: number; oo?: number; cc?: number; rr?: number }[]>(query, params);
      const row = rows[0] ?? {};
      return {
        totalInputTokens: row.ii ?? 0,
        totalOutputTokens: row.oo ?? 0,
        totalCostUsd: row.cc ?? 0,
        requests: row.rr ?? 0,
      };
    },

    async test() {
      try {
        const resolved = await resolveAIConfig(cfg, sql);
        await dispatch(resolved, [{ role: "user", content: "Reply with the word OK only." }]);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  };
}

function resolveDefaultModel(provider: AIProvider): string {
  switch (provider) {
    case "gemini": return "gemini-2.0-flash";
    case "anthropic": return "claude-3-5-haiku-20241022";
    case "kilo": return "claude-3-5-haiku";
    default: return "gpt-4o-mini";
  }
}
