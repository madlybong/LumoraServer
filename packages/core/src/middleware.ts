import type { Context, MiddlewareHandler, Next } from "hono";
import type { LumoraPrincipal } from "./types";
import type { LumoraDatabase } from "./db";

/**
 * Ensures the user is authenticated.
 * If authentication fails or is not present, it returns a 401 response.
 */
export function requireAuth() {
  return async (c: Context, next: Next) => {
    const user = c.get("user");
    if (!user || !user.subject) {
      if (c.var.fail) {
        return c.var.fail("UNAUTHORIZED", "Authentication required", 401);
      }
      return c.json({ ok: false, error: "Authentication required" }, 401);
    }
    await next();
  };
}

/**
 * Ensures the user has at least one of the required roles.
 * Super-admin bypasses this check.
 */
export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as LumoraPrincipal | undefined;
    if (!user || !user.subject) {
      if (c.var.fail) {
        return c.var.fail("UNAUTHORIZED", "Authentication required", 401);
      }
      return c.json({ ok: false, error: "Authentication required" }, 401);
    }

    const userRoles = user.roles || [];
    if (
      !userRoles.includes("super-admin") &&
      !roles.some((r) => userRoles.includes(r))
    ) {
      if (c.var.fail) {
        return c.var.fail("FORBIDDEN", "Insufficient permissions", 403);
      }
      return c.json({ ok: false, error: "Forbidden" }, 403);
    }

    await next();
  };
}

/**
 * Safely extracts the typed principal from the context.
 */
export function getPrincipal(c: Context): LumoraPrincipal {
  return c.get("user") as LumoraPrincipal;
}

export type PolicyDecision =
  | boolean
  | { allowed: boolean; reason?: string; code?: string };

/**
 * RFC-08: Generic declarative policy middleware.
 */
export function requirePolicy(
  predicate: (principal: LumoraPrincipal, c: Context) => PolicyDecision | Promise<PolicyDecision>,
  defaultMessage = "Policy check failed"
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as LumoraPrincipal | undefined;
    if (!user || !user.subject) {
      if (c.var.fail) {
        return c.var.fail("UNAUTHORIZED", "Authentication required", 401);
      }
      return c.json({ ok: false, error: "Authentication required" }, 401);
    }

    const result = await predicate(user, c);
    const allowed = typeof result === "boolean" ? result : result.allowed;
    if (!allowed) {
      const code = typeof result === "object" && result.code ? result.code : "POLICY_DENIED";
      const message = typeof result === "object" && result.reason ? result.reason : defaultMessage;
      if (c.var.fail) {
        return c.var.fail(code, message, 403);
      }
      return c.json({ ok: false, error: message, code }, 403);
    }

    await next();
  };
}

/**
 * RFC-08: Segregation of Duties (SoD) middleware.
 * Ensures the acting principal is not the same actor who created/initiated the target record.
 */
export function enforceSoD(
  resolveInitiatorSubject: (c: Context) => string | null | undefined | Promise<string | null | undefined>,
  message = "Segregation of Duties violation: initiator cannot approve or execute this action"
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as LumoraPrincipal | undefined;
    if (!user || !user.subject) {
      if (c.var.fail) {
        return c.var.fail("UNAUTHORIZED", "Authentication required", 401);
      }
      return c.json({ ok: false, error: "Authentication required" }, 401);
    }

    const initiator = await resolveInitiatorSubject(c);
    if (initiator && initiator === user.subject) {
      if (c.var.fail) {
        return c.var.fail("SOD_VIOLATION", message, 403);
      }
      return c.json({ ok: false, error: message, code: "SOD_VIOLATION" }, 403);
    }

    await next();
  };
}

export interface ThresholdTier {
  maxAmount: number;
  roles: string[];
}

/**
 * RFC-08: Tiered numeric/monetary threshold escalation middleware.
 */
export function requireThreshold(options: {
  getValue: (c: Context) => number | Promise<number>;
  tiers: ThresholdTier[];
  message?: string;
}): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as LumoraPrincipal | undefined;
    if (!user || !user.subject) {
      if (c.var.fail) {
        return c.var.fail("UNAUTHORIZED", "Authentication required", 401);
      }
      return c.json({ ok: false, error: "Authentication required" }, 401);
    }

    const userRoles = user.roles || [];
    if (userRoles.includes("super-admin")) {
      await next();
      return;
    }

    const amount = await options.getValue(c);
    const eligibleTiers = options.tiers.filter((t) => t.maxAmount >= amount);
    const allowed = eligibleTiers.some((tier) =>
      tier.roles.some((r) => userRoles.includes(r))
    );

    if (!allowed) {
      const msg = options.message ?? `Amount ${amount} exceeds authorized approval threshold for your role`;
      if (c.var.fail) {
        return c.var.fail("THRESHOLD_EXCEEDED", msg, 403);
      }
      return c.json({ ok: false, error: msg, code: "THRESHOLD_EXCEEDED" }, 403);
    }

    await next();
  };
}

export type TimeWindowDecision =
  | boolean
  | { open: boolean; reason?: string };

/**
 * RFC-08: Temporal window / period lock guard middleware.
 */
export function requireTimeWindow(
  checkWindow: (c: Context) => TimeWindowDecision | Promise<TimeWindowDecision>,
  defaultMessage = "Operation is not permitted outside the active time window"
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const result = await checkWindow(c);
    const open = typeof result === "boolean" ? result : result.open;
    if (!open) {
      const msg = typeof result === "object" && result.reason ? result.reason : defaultMessage;
      if (c.var.fail) {
        return c.var.fail("TIME_WINDOW_CLOSED", msg, 403);
      }
      return c.json({ ok: false, error: msg, code: "TIME_WINDOW_CLOSED" }, 403);
    }

    await next();
  };
}

export interface IdempotencyRecord {
  key: string;
  payloadHash: string;
  status: number;
  responseBody: string;
  createdAt: number;
  expiresAt: number;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  set(record: IdempotencyRecord): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private records = new Map<string, IdempotencyRecord>();

  async get(key: string): Promise<IdempotencyRecord | null> {
    const now = Date.now();
    const record = this.records.get(key);
    if (!record) return null;
    if (now > record.expiresAt) {
      this.records.delete(key);
      return null;
    }
    return record;
  }

  async set(record: IdempotencyRecord): Promise<void> {
    const now = Date.now();
    if (this.records.size > 2000) {
      for (const [k, v] of this.records.entries()) {
        if (now > v.expiresAt) this.records.delete(k);
      }
    }
    this.records.set(record.key, record);
  }
}

const ensuredDbIdempotencyTables = new WeakSet< object >();

async function ensureIdempotencyTable(db: LumoraDatabase): Promise<string> {
  const client = db.config.client;
  let schemaPrefix = "";
  if (client === "postgresql" && db.config.schema && db.config.schema !== "public") {
    schemaPrefix = `"${db.config.schema.replace(/[`"]/g, "")}".`;
  }
  const table = client === "postgresql"
    ? `${schemaPrefix}"_idempotency_keys"`
    : "`_idempotency_keys`";

  if (!ensuredDbIdempotencyTables.has(db.sql)) {
    const q = (col: string) => (client === "postgresql" ? `"${col}"` : `\`${col}\``);
    await db.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${table} (
        ${q("idempotency_key")} VARCHAR(255) PRIMARY KEY,
        ${q("payload_hash")} TEXT NOT NULL,
        ${q("status")} INTEGER NOT NULL,
        ${q("response_body")} TEXT NOT NULL,
        ${q("created_at")} BIGINT NOT NULL,
        ${q("expires_at")} BIGINT NOT NULL
      )
    `);
    ensuredDbIdempotencyTables.add(db.sql);
  }
  return table;
}

function escapeSqlStr(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

export interface IdempotencyOptions {
  /** Header name (default: 'Idempotency-Key', also falls back to 'X-Idempotency-Key') */
  header?: string;
  /** Time-to-live in milliseconds (default: 86_400_000 = 24h) */
  ttlMs?: number;
  /** Backing store: 'memory' (default), 'database' (uses c.var.db), or custom IdempotencyStore */
  store?: "memory" | "database" | IdempotencyStore;
  /** HTTP methods to guard (default: ['POST', 'PUT', 'PATCH', 'DELETE']) */
  methods?: string[];
  /** Require the idempotency header on guarded methods (default: false) */
  required?: boolean;
}

/**
 * RFC-09: Opt-in idempotency middleware with SHA-256 payload hashing and replay protection.
 */
export function idempotency(options: IdempotencyOptions = {}): MiddlewareHandler {
  const headerName = options.header ?? "Idempotency-Key";
  const ttlMs = options.ttlMs ?? 86_400_000;
  const methods = new Set((options.methods ?? ["POST", "PUT", "PATCH", "DELETE"]).map((m) => m.toUpperCase()));
  const memoryStore = new MemoryIdempotencyStore();

  const getRecord = async (c: Context, key: string): Promise<IdempotencyRecord | null> => {
    if (typeof options.store === "object" && options.store !== null) {
      return options.store.get(key);
    }
    if (options.store === "database") {
      const db = c.get("db") as LumoraDatabase | undefined;
      if (db) {
        const table = await ensureIdempotencyTable(db);
        const q = (col: string) => (db.config.client === "postgresql" ? `"${col}"` : `\`${col}\``);
        const now = Date.now();
        const rows = await db.sql.unsafe<Array<{
          idempotency_key: string;
          payload_hash: string;
          status: number | string;
          response_body: string;
          created_at: number | string;
          expires_at: number | string;
        }>>(
          `SELECT * FROM ${table} WHERE ${q("idempotency_key")} = ${escapeSqlStr(key)} LIMIT 1`
        );
        const row = rows[0];
        if (!row) return null;
        if (now > Number(row.expires_at)) {
          await db.sql.unsafe(`DELETE FROM ${table} WHERE ${q("idempotency_key")} = ${escapeSqlStr(key)}`);
          return null;
        }
        return {
          key: row.idempotency_key,
          payloadHash: row.payload_hash,
          status: Number(row.status),
          responseBody: row.response_body,
          createdAt: Number(row.created_at),
          expiresAt: Number(row.expires_at)
        };
      }
    }
    return memoryStore.get(key);
  };

  const setRecord = async (c: Context, record: IdempotencyRecord): Promise<void> => {
    if (typeof options.store === "object" && options.store !== null) {
      await options.store.set(record);
      return;
    }
    if (options.store === "database") {
      const db = c.get("db") as LumoraDatabase | undefined;
      if (db) {
        const table = await ensureIdempotencyTable(db);
        const q = (col: string) => (db.config.client === "postgresql" ? `"${col}"` : `\`${col}\``);
        await db.sql.unsafe(`DELETE FROM ${table} WHERE ${q("idempotency_key")} = ${escapeSqlStr(record.key)}`);
        await db.sql.unsafe(`
          INSERT INTO ${table} (${q("idempotency_key")}, ${q("payload_hash")}, ${q("status")}, ${q("response_body")}, ${q("created_at")}, ${q("expires_at")})
          VALUES (${escapeSqlStr(record.key)}, ${escapeSqlStr(record.payloadHash)}, ${Number(record.status)}, ${escapeSqlStr(record.responseBody)}, ${Number(record.createdAt)}, ${Number(record.expiresAt)})
        `);
        return;
      }
    }
    await memoryStore.set(record);
  };

  return async (c: Context, next: Next) => {
    if (!methods.has(c.req.method.toUpperCase())) {
      await next();
      return;
    }

    const rawKey = c.req.header(headerName) ?? c.req.header("X-Idempotency-Key");
    if (!rawKey) {
      if (options.required) {
        if (c.var.fail) {
          return c.var.fail("IDEMPOTENCY_KEY_REQUIRED", `Missing required ${headerName} header`, 400);
        }
        return c.json({ ok: false, error: `Missing required ${headerName} header` }, 400);
      }
      await next();
      return;
    }

    const user = c.get("user") as LumoraPrincipal | undefined;
    const scopePrefix = user?.tenantId ?? user?.subject ?? "anon";
    const scopedKey = `${scopePrefix}:${rawKey}`;

    const rawBody = await c.req.raw.clone().text().catch(() => "");
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(`${c.req.method.toUpperCase()}:${c.req.path}:${rawBody}`);
    const payloadHash = hasher.digest("hex");

    const existing = await getRecord(c, scopedKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        if (c.var.fail) {
          return c.var.fail(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key has already been used with a different request payload",
            409
          );
        }
        return c.json(
          { ok: false, error: "Idempotency key has already been used with a different request payload" },
          409
        );
      }

      return new Response(existing.responseBody, {
        status: existing.status,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Idempotency-Replayed": "true"
        }
      });
    }

    await next();

    if (c.res && c.res.status >= 200 && c.res.status < 300) {
      const responseBody = await c.res.clone().text().catch(() => "");
      const now = Date.now();
      await setRecord(c, {
        key: scopedKey,
        payloadHash,
        status: c.res.status,
        responseBody,
        createdAt: now,
        expiresAt: now + ttlMs
      });
      c.header("X-Idempotency-Replayed", "false");
    }
  };
}

/**
 * Standardized validation middleware that maps schema failures
 * to the Lumora HTTP Error envelope.
 */
export function validate(schema: { json?: any; query?: any; params?: any }) {
  return async (c: Context, next: Next) => {
    const valid: any = { json: {}, query: {}, params: {} };
    const errors: Record<string, string[]> = {};

    const validatePart = async (part: "json" | "query" | "params", getter: () => Promise<any> | any) => {
      if (!schema[part]) return;
      try {
        const data = await getter();
        if (schema[part].parse) {
          valid[part] = schema[part].parse(data);
        } else if (schema[part].validateSync) {
          valid[part] = schema[part].validateSync(data);
        } else {
          valid[part] = data; // fallback
        }
      } catch (err: any) {
        // Simple Zod/Yup error mapping extraction
        if (err.errors) {
          errors[part] = err.errors.map((e: any) => e.message || String(e));
        } else {
          errors[part] = [err.message || String(err)];
        }
      }
    };

    if (schema.json) {
      await validatePart("json", () => c.req.json().catch(() => ({})));
    }
    if (schema.query) {
      await validatePart("query", () => c.req.query());
    }
    if (schema.params) {
      await validatePart("params", () => c.req.param());
    }

    if (Object.keys(errors).length > 0) {
      if (c.var.fail) {
        return c.var.fail("VALIDATION_ERROR", "Validation failed", 400, errors);
      }
      return c.json({ ok: false, error: "Validation failed", details: errors }, 400);
    }

    c.set("valid", valid);
    await next();
  };
}
