# `@astrake/lumora-server` — Library Addition Plan

**Repo:** `https://github.com/madlybong/LumoraServer`  
**Package root:** `packages/core/src/`  
**Target version bump:** `0.1.5` → `0.1.6`  
**Runtime:** Bun 1.3 · Hono 4.9 · TypeScript 5.9+

This plan is self-contained. Do not reference any consumer application.
Implement all four additions in sequence, in the same PR/version bump.

---

## Source Map (read these files first)

| File | Purpose |
|---|---|
| `packages/core/src/types.ts` | All public types — extend here |
| `packages/core/src/config.ts` | `defineLumoraConfig`, `resolveLumoraConfig` — extend here |
| `packages/core/src/runtime.ts` | `initLumora()` — route generation — extend here |
| `packages/core/src/db.ts` | `LumoraDatabase` — add `_audit_logs` write here |
| `packages/core/src/resource.ts` | `defineResource` — passthrough, no change needed |
| `packages/core/src/index.ts` | Public exports — add new exports here |

---

## Addition 1 — Resource Permission Hooks

### Goal
Allow each `defineResource()` call to declare per-method permission guards.
The runtime calls the guard **after** JWT auth resolves and **before** the generated handler executes.
Throwing inside the guard returns `{ ok: false, error: "..." }` with HTTP 403.

### Changes

#### `packages/core/src/types.ts`

Add `ResourcePermissionContext` and `ResourcePermissions` types, then add `permissions?` to `ResourceSchema`.

```ts
// ADD after ResourceHooks interface

export type ResourceMethod = "GET_LIST" | "GET_ONE" | "POST" | "PUT" | "DELETE";

export interface ResourcePermissionContext {
  method: ResourceMethod;
  auth: LumoraAuthResult | undefined;
  id?: string;
}

export type ResourcePermissionGuard = (
  ctx: ResourcePermissionContext
) => void | Promise<void>;

export type ResourcePermissions = Partial<
  Record<ResourceMethod, ResourcePermissionGuard>
>;
```

In `ResourceSchema<TFields>`, add the optional field:
```ts
permissions?: ResourcePermissions;
```

#### `packages/core/src/runtime.ts`

Add a helper function (internal, not exported):

```ts
async function checkPermission(
  resource: DefineResourceResult,
  method: ResourceMethod,
  auth: LumoraAuthResult | undefined,
  id?: string
): Promise<Response | undefined> {
  const guard = resource.permissions?.[method];
  if (!guard) return undefined;
  try {
    await guard({ method, auth, id });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  return undefined;
}
```

In each route handler inside `initLumora()`, call `checkPermission` immediately after `authorizeOrRespond`:

- `app.get(resourceBase, ...)` → call `checkPermission(resource, "GET_LIST", auth)`
- `app.get(\`${resourceBase}/:id\`, ...)` → call `checkPermission(resource, "GET_ONE", auth, id)`
- `app.post(resourceBase, ...)` → call `checkPermission(resource, "POST", auth)`
- `app.put(\`${resourceBase}/:id\`, ...)` → call `checkPermission(resource, "PUT", auth, id)`
- `app.delete(\`${resourceBase}/:id\`, ...)` → call `checkPermission(resource, "DELETE", auth, id)`

Pattern for each handler (example: POST):
```ts
app.post(resourceBase, async (c) => {
  const auth = await authorizeOrRespond(config, resource, c);
  if (auth instanceof Response) return auth;

  const denied = await checkPermission(resource, "POST", auth);  // ADD THIS
  if (denied) return denied;                                      // ADD THIS

  // ... existing handler body unchanged
});
```

### Tests to add
File: `packages/core/src/tests/permissions.test.ts` (or alongside existing tests)

- Resource with no `permissions` → all methods pass through (no regression)
- Guard that returns normally → request proceeds, 200/201 returned
- Guard that throws `"Forbidden"` → 403 returned with `{ ok: false, error: "Forbidden" }`
- Guard receives correct `method`, `auth.subject`, and `id` values
- `GET_LIST` guard does not receive `id`; `GET_ONE` and `PUT` and `DELETE` do

---

## Addition 2 — Audit Trail (`audit: true`)

### Goal
When a resource is defined with `audit: true`, every `POST`, `PUT`, `DELETE` automatically writes a structured record to a system table named `_audit_logs` using the same `LumoraDatabase` connection.
The `_audit_logs` table is NOT exposed as a generated REST resource. Consumers may expose it manually via a separate `defineResource` if desired.

### Changes

#### `packages/core/src/types.ts`

Add `audit?` to `ResourceSchema`:
```ts
audit?: boolean;
```

Add the audit log record shape (internal use):
```ts
export interface AuditLogRecord {
  id: string;
  resource: string;
  action: "create" | "update" | "delete";
  record_id: string;
  actor_subject: string;
  actor_strategy: string;
  old_value: string;   // JSON string
  new_value: string;   // JSON string
  request_id: string;
  request_path: string;
  timestamp: string;   // ISO 8601
}
```

#### `packages/core/src/db.ts`

Add a method to `LumoraDatabase`:

```ts
async ensureAuditTable(): Promise<void> {
  const ddl = `
    CREATE TABLE IF NOT EXISTS \`_audit_logs\` (
      \`id\` VARCHAR(191) PRIMARY KEY,
      \`resource\` TEXT NOT NULL,
      \`action\` TEXT NOT NULL,
      \`record_id\` TEXT NOT NULL,
      \`actor_subject\` TEXT NOT NULL,
      \`actor_strategy\` TEXT NOT NULL,
      \`old_value\` TEXT NOT NULL,
      \`new_value\` TEXT NOT NULL,
      \`request_id\` TEXT NOT NULL,
      \`request_path\` TEXT NOT NULL,
      \`timestamp\` TEXT NOT NULL
    )`;
  await this.sql.unsafe(ddl);
}

async writeAuditLog(entry: Omit<AuditLogRecord, "id">): Promise<void> {
  const id = crypto.randomUUID();
  const columns = Object.keys({ id, ...entry }).map(quoteIdentifier).join(", ");
  const values = Object.values({ id, ...entry })
    .map((v) => escapeValue(v))
    .join(", ");
  await this.sql.unsafe(
    `INSERT INTO \`_audit_logs\` (${columns}) VALUES (${values})`
  );
}
```

#### `packages/core/src/runtime.ts`

In `initLumora()`, after `await database.connect()`, call:
```ts
await database.ensureAuditTable();
```

Add an internal helper:
```ts
async function writeAudit(
  database: LumoraDatabase,
  resource: DefineResourceResult,
  action: "create" | "update" | "delete",
  auth: LumoraAuthResult | undefined,
  audit: RequestAudit,
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  recordId: string
): Promise<void> {
  if (!resource.audit) return;
  await database.writeAuditLog({
    resource: resource.resource,
    action,
    record_id: recordId,
    actor_subject: auth?.subject ?? "anonymous",
    actor_strategy: auth?.strategy ?? "none",
    old_value: JSON.stringify(oldValue),
    new_value: JSON.stringify(newValue),
    request_id: audit.requestId,
    request_path: audit.path,
    timestamp: new Date().toISOString(),
  });
}
```

Call `writeAudit` in each mutating handler after the DB write succeeds:

- **POST** (after `database.create` returns `record`):
  ```ts
  await writeAudit(database, resource, "create", auth, audit, {}, record, record.id as string);
  ```
- **PUT** (after `database.update` returns `record`):
  ```ts
  await writeAudit(database, resource, "update", auth, audit, existingSnapshot, record, c.req.param("id"));
  ```
  Note: for PUT, capture the existing record before `database.update` by calling `database.get(resource, id)` — store as `existingSnapshot`.
- **DELETE** (after `database.delete` returns `record`):
  ```ts
  await writeAudit(database, resource, "delete", auth, audit, record, {}, record.id as string);
  ```

### Tests to add

- Resource with `audit: false` (default) → `_audit_logs` table has no new rows after mutation
- Resource with `audit: true` → POST creates one `_audit_logs` row; action = "create"; old_value = "{}"
- Resource with `audit: true` → PUT creates one row; old_value contains pre-update state; new_value contains updated fields
- Resource with `audit: true` → DELETE creates one row; old_value contains deleted record; new_value = "{}"
- `actor_subject` matches the JWT `subject` claim
- Multiple resources sharing DB: audit rows for each resource are correctly namespaced by `resource` column

---

## Addition 3 — SMTP Email Plugin

### Goal
An optional `email` block in `defineLumoraConfig`. When present, `initLumora()` returns an `email` property on the `LumoraInstance` with `send()` and `test()` methods.
Config may be static (inline credentials) or `"db"` (reads from a named table's key-value rows at call time — no restart required after config change).
Implementation is a thin `nodemailer` wrapper.

### Dependency

Add to `packages/core/package.json`:
```json
"dependencies": {
  "nodemailer": "^6.9.0"
}
```
Add to `packages/core/package.json` devDependencies:
```json
"@types/nodemailer": "^6.4.0"
```

### New file: `packages/core/src/email.ts`

```ts
import nodemailer from "nodemailer";
import type { SQL } from "bun";

export interface SmtpStaticConfig {
  source: "static";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

export interface SmtpDbConfig {
  source: "db";
  table: string;   // e.g. "app_settings"
  keyColumn: string;   // column containing the setting name, default "key"
  valueColumn: string; // column containing the setting value, default "value"
}

export type LumoraEmailConfig = SmtpStaticConfig | SmtpDbConfig;

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export interface LumoraEmailService {
  send(options: SendMailOptions): Promise<void>;
  test(): Promise<{ ok: boolean; error?: string }>;
}

async function resolveSmtpConfig(
  cfg: LumoraEmailConfig,
  sql?: SQL
): Promise<SmtpStaticConfig> {
  if (cfg.source === "static") return cfg;

  if (!sql) throw new Error("DB-backed SMTP config requires a database connection.");

  const keyCol = cfg.keyColumn ?? "key";
  const valCol = cfg.valueColumn ?? "value";
  const rows = await sql.unsafe<{ key: string; value: string }[]>(
    `SELECT \`${keyCol}\` as key, \`${valCol}\` as value FROM \`${cfg.table}\`
     WHERE \`${keyCol}\` IN ('smtp_host','smtp_port','smtp_secure','smtp_user','smtp_pass','smtp_from_name','smtp_from_email')`
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    source: "static",
    host: m.smtp_host ?? "",
    port: Number(m.smtp_port ?? 587),
    secure: m.smtp_secure === "true",
    user: m.smtp_user ?? "",
    pass: m.smtp_pass ?? "",
    fromName: m.smtp_from_name ?? "",
    fromEmail: m.smtp_from_email ?? "",
  };
}

export function createEmailService(
  cfg: LumoraEmailConfig,
  sql?: SQL
): LumoraEmailService {
  return {
    async send(options) {
      const resolved = await resolveSmtpConfig(cfg, sql);
      const transporter = nodemailer.createTransport({
        host: resolved.host,
        port: resolved.port,
        secure: resolved.secure,
        auth: { user: resolved.user, pass: resolved.pass },
      });
      await transporter.sendMail({
        from: `"${resolved.fromName}" <${resolved.fromEmail}>`,
        to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
    },
    async test() {
      try {
        const resolved = await resolveSmtpConfig(cfg, sql);
        const transporter = nodemailer.createTransport({
          host: resolved.host,
          port: resolved.port,
          secure: resolved.secure,
          auth: { user: resolved.user, pass: resolved.pass },
        });
        await transporter.verify();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  };
}
```

### Changes to `packages/core/src/types.ts`

Import and add to `LumoraConfig`:
```ts
import type { LumoraEmailConfig } from "./email";

// Inside LumoraConfig interface:
email?: LumoraEmailConfig;
```

Add `email` to `LumoraInstance`:
```ts
import type { LumoraEmailService } from "./email";

// Inside LumoraInstance interface:
email?: LumoraEmailService;
```

### Changes to `packages/core/src/runtime.ts`

After `await database.connect()` in `initLumora()`:
```ts
import { createEmailService } from "./email";

const emailService = config.email
  ? createEmailService(config.email, database.sql)
  : undefined;
```

Add `email: emailService` to the returned `LumoraInstance` object.

### Export
Add to `packages/core/src/index.ts`:
```ts
export * from "./email";
```

### Tests to add
- `source: "static"` config → `test()` calls `nodemailer.verify()` (mock transporter)
- `source: "db"` config → reads rows from mock SQL; resolves correct field values
- `send()` with `source: "static"` → calls `transporter.sendMail()` with correct `from`, `to`, `subject`
- Missing `smtp_host` in DB → `send()` throws a clear error
- No `email` config in `defineLumoraConfig` → `instance.email` is `undefined` (no crash)

---

## Addition 4 — AI Provider Plugin

### Goal
An optional `ai` block in `defineLumoraConfig`. When present, `initLumora()` returns an `ai` property on `LumoraInstance` with `complete(prompt)` and `test()` methods.
Provider and key are resolved from `app_settings` at call time (BYOK — no restart needed).
Implementation is a thin `fetch` wrapper only — no LLM SDK dependency.

Supported providers: `"gemini"` (default), `"openai"`, `"custom"` (any OpenAI-compatible base URL).

### New file: `packages/core/src/ai.ts`

```ts
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
```

### Changes to `packages/core/src/types.ts`

```ts
import type { LumoraAIConfig } from "./ai";
import type { LumoraAIService } from "./ai";

// Inside LumoraConfig:
ai?: LumoraAIConfig;

// Inside LumoraInstance:
ai?: LumoraAIService;
```

### Changes to `packages/core/src/runtime.ts`

After `emailService` initialization:
```ts
import { createAIService } from "./ai";

const aiService = config.ai
  ? createAIService(config.ai, database.sql)
  : undefined;
```

Add `ai: aiService` to the returned `LumoraInstance`.

### Export

Add to `packages/core/src/index.ts`:
```ts
export * from "./ai";
```

### Tests to add
- `source: "static"`, `provider: "gemini"` → `complete()` calls correct Gemini URL with API key
- `source: "static"`, `provider: "openai"` → `complete()` calls `api.openai.com/v1/chat/completions`
- `source: "static"`, `provider: "custom"`, `baseUrl: "http://local:11434"` → calls `http://local:11434/v1/chat/completions`
- `source: "db"` → reads `ai_provider`, `ai_api_key` from mock SQL rows before calling provider
- `test()` → returns `{ ok: true }` on success; `{ ok: false, error: "..." }` on fetch failure
- No `ai` config → `instance.ai` is `undefined` (no crash)

---

## Version & Export Checklist

1. Bump `packages/core/VERSION` from `0.1.5` to `0.1.6`
2. `packages/core/src/index.ts` must export `./email` and `./ai`
3. `ResourceSchema` and `DefineResourceResult` must include `permissions?` and `audit?`
4. `LumoraConfig` must include `email?` and `ai?`
5. `LumoraInstance` must include `email?` and `ai?`
6. Run `bun run check` (tsc) — zero errors
7. Run `bun test` — all existing tests pass + new tests pass
8. Update `CHANGELOG.md` with one entry per addition under `## [0.1.6]`

## Guardrails (from project ROADMAP)
- Keep the framework slim — no new required dependencies beyond `nodemailer`
- `nodemailer` is a peer/optional pattern — if absent and `email` config is set, throw a clear startup error
- Do not expose `_audit_logs` as a generated REST route — it is a system table
- The `ai` service is a thin `fetch` wrapper only — do not add any LLM SDK
- `permissions` and `audit` must be zero-cost when not configured (no overhead on resources that omit them)
