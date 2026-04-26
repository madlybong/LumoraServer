import type { SQL } from "bun";

export interface AIStaticConfig {
  source: "static";
  provider: "gemini" | "openai" | "custom";
  apiKey: string;
  baseUrl?: string; // required when provider = "custom"
  model?: string;
}

export interface AIDbConfig {
  source: "db";
  table: string;
  keyColumn?: string;   // default "key"
  valueColumn?: string; // default "value"
}

export type LumoraAIConfig = AIStaticConfig | AIDbConfig;

export interface LumoraAIService {
  complete(prompt: string): Promise<string>;
  test(): Promise<{ ok: boolean; error?: string }>;
}

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
     WHERE \`${keyCol}\` IN ('ai_provider','ai_api_key','ai_api_base_url','ai_model')`
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    source: "static",
    provider: (m.ai_provider as AIStaticConfig["provider"]) ?? "gemini",
    apiKey: m.ai_api_key ?? "",
    baseUrl: m.ai_api_base_url || undefined,
    model: m.ai_model || undefined,
  };
}

async function callProvider(cfg: AIStaticConfig, prompt: string): Promise<string> {
  if (cfg.provider === "gemini") {
    const model = cfg.model ?? "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  // openai or custom (OpenAI-compatible)
  const baseUrl = cfg.baseUrl ?? "https://api.openai.com";
  const model = cfg.model ?? "gpt-4o-mini";
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI error: ${res.status} ${await res.text()}`);
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

export function createAIService(
  cfg: LumoraAIConfig,
  sql?: SQL
): LumoraAIService {
  return {
    async complete(prompt) {
      const resolved = await resolveAIConfig(cfg, sql);
      return callProvider(resolved, prompt);
    },
    async test() {
      try {
        const resolved = await resolveAIConfig(cfg, sql);
        await callProvider(resolved, "Reply with the word OK only.");
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  };
}
