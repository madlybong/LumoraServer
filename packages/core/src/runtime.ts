import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Hono, type Context } from "hono";
import { createBunWebSocket } from "hono/bun";
import { buildOpenApiDocument, renderDocsUi } from "./docs";
import { LumoraEventEmitter } from "./events";
import { resolveAuthFromContext } from "./auth";
import { loadLumoraConfig } from "./config";
import { LumoraDatabase } from "./db";
import { LumoraRealtimeHub } from "./realtime";
import { normalizeResourcePath } from "./resource";
import { createEmailService } from "./email";
import { createAIService } from "./ai";
import { LumoraLogger } from "./logger";
import { handleFileUpload, hasFileFields, serveUploadedFile } from "./upload";
import { exportToCsv, getCsvFilename } from "./export";
import { rateLimit, MemoryRateLimitStore, PostgresRateLimitStore } from "./rate-limit";
import { startScheduler } from "./scheduler";
import { createQueryExecutor } from "./query";
import { LumoraMigrationEngine } from "./migrations";
import { LumoraDuplicateError } from "./types";
import { LumoraHttpError } from "./errors";
import { parsePagination } from "./utils";

import type {
  DefineResourceResult,
  LumoraConfig,
  LumoraEventMap,
  LumoraInstance,
  RequestAudit,
  ResourceEventPayload,
  ResolvedLumoraConfig,
  ResourceMethod,
  LumoraAuthResult,
  ResourceExportCsvOptions,
  AuditLogOpts,
  LumoraModuleContext,
  SseAuthOptions,
  LumoraHonoVariables
} from "./types";

interface AppVariables extends LumoraHonoVariables {
  jwtPayload?: unknown;
}

function apiPrefix(config: ResolvedLumoraConfig): string {
  return `/${normalizeResourcePath(config.api.base)}/${normalizeResourcePath(config.api.version)}`.replace(/\/+/g, "/");
}

function parseBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

function validatePayload(
  resource: DefineResourceResult,
  input: Record<string, unknown>,
  mode: "create" | "update"
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [name, field] of Object.entries(resource.fields)) {
    if (field.readOnly) continue;
    // Skip file fields — they are handled separately by handleFileUpload
    if (field.type === "file" || field.type === "file[]") continue;
    const value = input[name] ?? field.default;
    if (mode === "create" && field.required && (value === undefined || value === null || value === "")) {
      throw new Error(`Field "${name}" is required.`);
    }
    if (value === undefined) {
      continue;
    }
    output[name] = value;
  }

  return output;
}

function errorResponse(message: string, status: number, requestId?: string): Response {
  return new Response(
    JSON.stringify({ ok: false, error: message, ...(requestId ? { requestId } : {}) }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// LS-1: Resolve computed/virtual fields for a single record (read-only, never stored)
async function resolveComputed(
  record: Record<string, unknown>,
  resource: DefineResourceResult,
  auth: LumoraAuthResult | undefined,
  database: LumoraDatabase
): Promise<Record<string, unknown>> {
  if (!resource.computed || Object.keys(resource.computed).length === 0) return record;
  const entries = await Promise.all(
    Object.entries(resource.computed).map(async ([key, def]) => {
      const value = await def.resolve(record, { auth, database });
      return [key, value] as [string, unknown];
    })
  );
  return { ...record, ...Object.fromEntries(entries) };
}

// LS-2: Resolve relational includes for a single record
async function resolveIncludes(
  record: Record<string, unknown>,
  resource: DefineResourceResult,
  includes: string[],
  allResources: DefineResourceResult[],
  database: LumoraDatabase
): Promise<Record<string, unknown>> {
  if (!resource.relations || includes.length === 0) return record;
  const resolved: Record<string, unknown> = { ...record };

  for (const includeName of includes) {
    const relation = resource.relations[includeName];
    if (!relation) continue; // Silently ignore unknown include names

    const relatedResource = allResources.find((r) => r.resource === relation.resource);
    if (!relatedResource) continue;

    if (relation.type === "belongsTo") {
      const fkValue = record[relation.foreignKey];
      if (fkValue === null || fkValue === undefined) {
        resolved[includeName] = null;
        continue;
      }
      const matchField = relation.matchOn ?? "id";
      if (matchField === "id") {
        resolved[includeName] = await database.get(relatedResource, String(fkValue));
      } else {
        resolved[includeName] = await database.getByField(relatedResource, matchField, fkValue);
      }
    } else if (relation.type === "hasMany") {
      // foreignKey is the field on the RELATED resource pointing back to this record's id
      resolved[includeName] = await database.listByField(relatedResource, relation.foreignKey, record.id);
    }
  }

  return resolved;
}

async function resolveIncludesBatch(
  records: Record<string, unknown>[],
  resource: import("./types").DefineResourceResult,
  includes: string[],
  allResources: import("./types").DefineResourceResult[],
  database: import("./db").LumoraDatabase
): Promise<Record<string, unknown>[]> {
  if (!resource.relations || includes.length === 0) return records;
  const result = records.map(r => ({ ...r })); // shallow clone each record

  for (const includeName of includes) {
    const relation = resource.relations[includeName];
    if (!relation) continue;
    const relatedResource = allResources.find(r => r.resource === relation.resource);
    if (!relatedResource) continue;

    if (relation.type === "belongsTo") {
      const matchField = relation.matchOn ?? "id";
      const fkValues = [...new Set(
        result.map(r => r[relation.foreignKey]).filter(v => v != null) as string[]
      )];
      let lookup: Map<string, Record<string, unknown>>;
      if (matchField === "id") {
        lookup = await database.getByIds(relatedResource, fkValues);
      } else {
        const rows = await database.listByIds(relatedResource, matchField, fkValues);
        lookup = new Map(rows.map(r => [String(r[matchField]), r]));
      }
      for (const record of result) {
        const fkVal = record[relation.foreignKey];
        record[includeName] = fkVal != null ? (lookup.get(String(fkVal)) ?? null) : null;
      }
    } else if (relation.type === "hasMany") {
      const parentIds = result.map(r => r.id).filter(v => v != null) as string[];
      const allRelated = await database.listByIds(relatedResource, relation.foreignKey, parentIds);
      for (const record of result) {
        record[includeName] = allRelated.filter(
          r => String(r[relation.foreignKey]) === String(record.id)
        );
      }
    }
  }
  return result;
}

function filterFieldsByRole(
  record: Record<string, unknown>,
  resource: DefineResourceResult,
  userRoles: string[]
): Record<string, unknown> {
  const filtered: Record<string, unknown> = { ...record };
  for (const [name, field] of Object.entries(resource.fields)) {
    if (field.visibleTo && field.visibleTo.length > 0) {
      if (!userRoles.includes("super-admin") && !field.visibleTo.some((r) => userRoles.includes(r))) {
        delete filtered[name];
      }
    }
  }
  return filtered;
}

async function walkRoutes(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkRoutes(absolute)));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(absolute);
    }
  }
  return files;
}

async function loadResources(config: ResolvedLumoraConfig): Promise<DefineResourceResult[]> {
  if (!config.routes) return [];
  const routeDir = path.resolve(config.rootDir, config.routes.dir);
  const files = await walkRoutes(routeDir);
  const resources: DefineResourceResult[] = [];

  for (const file of files) {
    const mod = await import(pathToFileURL(file).href);
    const resource = mod.default ?? mod.resource;
    if (!resource) {
      continue;
    }
    resources.push(resource as DefineResourceResult);
  }

  return resources;
}

function buildAudit(method: string, pathname: string, requestId: string): RequestAudit {
  return {
    requestId,
    method,
    path: pathname
  };
}

function matchesPathPattern(pathname: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    return pathname === base || pathname.startsWith(`${base}/`);
  }
  return pathname === pattern;
}

function extractTenantIdFromAuth(
  config: ResolvedLumoraConfig,
  authResult: LumoraAuthResult | undefined
): string | undefined {
  if (!authResult) return undefined;
  const mappedKey = config.auth.mode === "jwt" ? config.auth.claimMapping?.tenantId : undefined;
  const candidate =
    authResult.scope?.tenant_id ??
    authResult.scope?.tenantId ??
    (mappedKey ? authResult.claims?.[mappedKey] : undefined) ??
    authResult.claims?.tenant_id ??
    authResult.claims?.tenantId ??
    authResult.claims?.companyId;
  return typeof candidate === "string" ? candidate : undefined;
}

async function authorize(
  config: ResolvedLumoraConfig,
  resource: DefineResourceResult,
  c: Context<{ Variables: AppVariables }>,
  tokenOverride?: string,
  database?: LumoraDatabase
) {
  const mode = resource.auth?.mode ?? "inherit";
  if (mode === "public") {
    return undefined;
  }
  if (config.mode !== "production" && config.auth.mode === "disabled") {
    return undefined;
  }
  const authResult = await resolveAuthFromContext(c as unknown as Context, config.auth, tokenOverride);
  // LP-04 & RFC-01: call afterVerify hook if configured (supports both jwt and custom modes)
  if (authResult && (config.auth.mode === "jwt" || config.auth.mode === "custom") && config.auth.afterVerify) {
    const hookResult = await config.auth.afterVerify(authResult, c as unknown as Context);
    if (hookResult instanceof Response) return hookResult;
  }

  if (authResult) {
    const tenantId = extractTenantIdFromAuth(config, authResult);
    const principal = {
      id: authResult.subject,
      subject: authResult.subject,
      roles: authResult.roles ?? (authResult.claims?.roles as string[] | undefined) ?? [],
      tenantId,
      scopes: authResult.scopes,
      claims: authResult.claims
    };
    c.set("user", principal);
    c.set("userRole", principal.roles[0] ?? "user");
    if (database && tenantId) {
      const scopedDb = database.scoped(tenantId);
      c.set("db", scopedDb);
      c.set("logAudit", (opts, options) => logAudit(scopedDb, opts, options));
    }
  }

  return authResult;
}

async function authorizeOrRespond(
  config: ResolvedLumoraConfig,
  resource: DefineResourceResult,
  c: Context<{ Variables: AppVariables }>
) {
  try {
    return await authorize(config, resource, c);
  } catch (error) {
    return c.json({ ok: false, error: String(error) }, 401);
  }
}

async function checkPermission(
  resource: DefineResourceResult,
  method: ResourceMethod,
  auth: LumoraAuthResult | undefined,
  id?: string
): Promise<Response | undefined> {
  const perms = resource.permissions;
  if (!perms) return undefined;

  // Role-based check: user must have at least one matching role (super-admin always passes)
  if (perms.roles && perms.roles.length > 0) {
    const userRoles = auth?.roles ?? (auth?.claims?.roles as string[] | undefined) ?? [];
    if (
      !userRoles.includes("super-admin") &&
      !perms.roles.some((r) => userRoles.includes(r))
    ) {
      return new Response(
        JSON.stringify({ ok: false, error: "Forbidden" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Custom allow() guard (full control)
  if (perms.allow) {
    const allowed = await perms.allow(auth as LumoraAuthResult, method);
    if (!allowed) {
      return new Response(
        JSON.stringify({ ok: false, error: "Forbidden" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return undefined;
}


async function writeAudit(
  config: ResolvedLumoraConfig,
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
  const hashChain = Boolean(
    config.auditHashChain ||
    config.database.auditHashChain ||
    (typeof resource.audit === "object" && resource.audit.hashChain)
  );
  const tenantId = extractTenantIdFromAuth(config, auth);
  await database.writeAuditLog(
    {
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
      ...(tenantId ? { tenant_id: tenantId } : {})
    },
    { hashChain }
  );
}

/**
 * Initializes the Lumora server instance.
 * 
 * @example
 * ```typescript
 * import { initLumora } from "@astrake/lumora-server";
 * 
 * const lumora = await initLumora("./lumora.config.ts");
 * export default {
 *   port: 3000,
 *   fetch: lumora.fetch,
 *   websocket: lumora.websocket
 * };
 * ```
 */
export async function initLumora(configOrPath: LumoraConfig | string): Promise<LumoraInstance> {
  const config = await loadLumoraConfig(configOrPath);
  const events = new LumoraEventEmitter<LumoraEventMap>();
  const realtime = new LumoraRealtimeHub(
    config.auth.mode === "jwt" ? config.auth.secret : undefined,
    {
      heartbeatIntervalMs: config.realtime.heartbeatIntervalMs,
      maxReplayBuffer: config.realtime.maxReplayBuffer
    }
  );
  const database = new LumoraDatabase(config.database, events, config.multiTenancy);
  const resources: DefineResourceResult[] = config.resources
    ? config.resources
    : config.routes
      ? await loadResources(config)
      : [];

  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const app = new Hono<{ Variables: AppVariables }>();
  const logger = new LumoraLogger(config.logging.level);

  // RFC-10: Lightweight zero-overhead request telemetry counters
  const startedAt = Date.now();
  let requestsTotal = 0;
  let errorsTotal = 0;
  let latencySumMs = 0;
  const statusCounts: Record<string, number> = {};

  app.use("*", async (c, next) => {
    if (config.cors.passthrough) {
      await next();
      return;
    }
    const { origin, methods, headers, credentials, exposeHeaders, maxAge } = config.cors;
    const requestOrigin = c.req.header("origin") ?? "";
    const allowed = origin === "*"
      || (Array.isArray(origin) ? origin.includes(requestOrigin) : requestOrigin === origin);
    if (allowed && origin) {
      c.header("Access-Control-Allow-Origin", Array.isArray(origin) ? requestOrigin : origin as string);
    }
    c.header("Access-Control-Allow-Methods", methods.join(", "));
    c.header("Access-Control-Allow-Headers", headers.join(", "));
    if (credentials) c.header("Access-Control-Allow-Credentials", "true");
    if (exposeHeaders && exposeHeaders.length > 0) {
      c.header("Access-Control-Expose-Headers", exposeHeaders.join(", "));
    }
    if (maxAge !== undefined) {
      c.header("Access-Control-Max-Age", String(maxAge));
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.onError((err, c) => {
    logger.error("app:error", err, c.get("requestId"));
    
    if (err instanceof LumoraHttpError) {
      return c.json({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details },
        requestId: c.get("requestId")
      }, err.status as 400);
    }

    const isProd = config.mode === "production";
    return c.json({
      ok: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: isProd ? "An unexpected internal error occurred." : (err as Error).message,
        details: isProd ? undefined : (err as Error).stack
      },
      requestId: c.get("requestId")
    }, 500);
  });

  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.set("db", database);
    c.set("logAudit", (opts, options) => logAudit(database, opts, {
      ...options,
      hashChain: options?.hashChain ?? opts.hashChain ?? config.auditHashChain ?? config.database.auditHashChain
    }));
    c.header("X-Request-Id", requestId);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");

    c.set("lumoraJson", (data: unknown, status = 200) => {
      return c.json({ ok: true, data }, status as 200);
    });
    c.set("lumoraError", (message: string, status = 400) => {
      return c.json({ ok: false, error: message, requestId: c.get("requestId") }, status as 400);
    });
    c.set("ok", ((data: unknown, meta?: Record<string, unknown>) => {
      return c.json({ ok: true, data, meta, requestId: c.get("requestId") }, 200);
    }) as LumoraHonoVariables["ok"]);
    c.set("list", ((rows: unknown[], meta: { total: number; page: number; pageSize: number; [key: string]: unknown }) => {
      return c.json({ ok: true, data: rows, meta, requestId: c.get("requestId") }, 200);
    }) as LumoraHonoVariables["list"]);
    c.set("created", ((data: unknown) => {
      return c.json({ ok: true, data, requestId: c.get("requestId") }, 201);
    }) as LumoraHonoVariables["created"]);
    c.set("noContent", () => {
      return new Response(null, { status: 204 });
    });
    c.set("fail", (code: string, message: string, status: number, details?: unknown) => {
      return c.json({ ok: false, error: { code, message, details }, requestId: c.get("requestId") }, status as 400);
    });
    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;
    requestsTotal++;
    latencySumMs += durationMs;
    const statusKey = String(c.res.status);
    statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;
    if (c.res.status >= 500) {
      errorsTotal++;
    }
    logger.request(c.req.method, new URL(c.req.url).pathname, c.res.status, durationMs, requestId);
  });

  if (config.auth.protectedPaths && config.auth.protectedPaths.length > 0) {
    const publicPaths = config.auth.publicPaths ?? [];
    for (const p of config.auth.protectedPaths) {
      app.use(p, async (c, next) => {
        const pathname = new URL(c.req.url).pathname;
        if (publicPaths.some((pub) => matchesPathPattern(pathname, pub))) {
          await next();
          return;
        }
        const auth = await authorize(config, { kind: "resource", resource: "_root", fields: {} }, c, undefined, database).catch((err) => {
          logger.event("auth", String(err));
          return errorResponse(String(err), 401, c.get("requestId"));
        });
        if (auth instanceof Response) return auth;
        await next();
      });
    }
  }

  await database.connect();
  await database.ensureAuditTable();
  await database.ensureCronLogTable();

  // Migration engine — mode-aware (auto in dev, strict in prod, off in test)
  const migrationEngine = new LumoraMigrationEngine(database, config, logger);
  try {
    await migrationEngine.run();
  } catch (err) {
    await database.close().catch(() => {});
    throw err;
  }

  const emailService = config.email
    ? createEmailService(config.email, database.sql)
    : undefined;

  const aiService = config.ai
    ? createAIService(config.ai, database.sql)
    : undefined;

  const rateLimitStore = config.rateLimit.enabled 
    ? (config.rateLimit.store === "database"
        ? new PostgresRateLimitStore(database.sql, config.database.client === "postgresql" ? config.database.schema : undefined)
        : new MemoryRateLimitStore())
    : undefined;

  logger.event("init", "starting lumora instance...");
  events.emit("lifecycle:init", { config });

  for (const resource of resources) {
    await database.ensureResource(resource);
    const resourceBase = `${apiPrefix(config)}/${normalizeResourcePath(resource.resource)}`.replace(/\/+/g, "/");

    const globalRl  = config.rateLimit;
    const resourceRl = resource.rateLimit;
    const applyRl   = globalRl.enabled && !resourceRl?.disabled;

    if (applyRl) {
      const effectiveMax      = resourceRl?.max      ?? globalRl.max;
      const effectiveWindowMs = resourceRl?.windowMs ?? globalRl.windowMs;
      const rlMw = rateLimit({
        limit:    effectiveMax,
        windowMs: effectiveWindowMs,
        store:    rateLimitStore,
      });
      const seenReq = new WeakSet<Request>();
      const guardedRl: import("hono").MiddlewareHandler = async (c, next) => {
        if (seenReq.has(c.req.raw)) {
          await next();
          return;
        }
        seenReq.add(c.req.raw);
        return rlMw(c, next);
      };
      app.use(resourceBase, guardedRl);
      app.use(`${resourceBase}/*`, guardedRl);
    }

    app.get(resourceBase, async (c) => {
      const auth = await authorize(config, resource, c, undefined, database).catch((err) => {
        // Auth errors (expired tokens, bad credentials) are expected user-level errors; log verbosely only
        logger.event("auth", String(err));
        return errorResponse(String(err), 401, c.get("requestId"));
      });
      if (auth instanceof Response) {
        return auth;
      }
      const denied = await checkPermission(resource, "GET_LIST", auth).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : errorResponse(String(err), 403, c.get("requestId"));
      });
      if (denied) return denied;
      const { page, pageSize } = parsePagination(
        c,
        resource.query?.defaultPageSize ?? 20,
        resource.query?.maxPageSize ?? 100
      );
      // LS-9: extract scope from auth for store-scoped resources
      const resourceScopeDef = resource.permissions?.scope;
      const scopeValue = resourceScopeDef && auth?.scope?.[resourceScopeDef.field];
      const scopeOption = resourceScopeDef && scopeValue !== undefined
        ? { field: resourceScopeDef.field, value: scopeValue }
        : undefined;
      const reqDb = c.get("db") ?? database;
      const result = await reqDb.list(resource, {
        filters: new URL(c.req.url).searchParams,
        search: c.req.query("search"),
        sort: c.req.query("sort"),
        cursor: c.req.query("cursor"),
        page,
        pageSize,
        scope: scopeOption
      });

      // LS-1 + LS-2: resolve computed fields and relational includes
      const includeParam = c.req.query("include");
      const includes = includeParam ? includeParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
      let items = result.items;
      if (includes.length > 0) {
        items = await resolveIncludesBatch(items, resource, includes, resources, reqDb);
      }
      if (resource.computed) {
        items = await Promise.all(
          items.map(async (record) => await resolveComputed(record, resource, auth, reqDb))
        );
      }
      const userRoles = auth?.roles ?? (auth?.claims?.roles as string[] | undefined) ?? [];
      items = items.map(record => filterFieldsByRole(record, resource, userRoles));
      const totalPages = result.pageSize > 0 ? Math.ceil(result.total / result.pageSize) : 0;
      const hasNextPage = result.page < totalPages;
      return c.json({ ok: true, data: items, total: result.total, page: result.page, pageSize: result.pageSize, totalPages, hasNextPage, nextCursor: result.nextCursor });
    });

    // LS-5: CSV export endpoint (only if resource declares export.csv)
    if (resource.export?.csv) {
      const csvOpts: ResourceExportCsvOptions = typeof resource.export.csv === "object" ? resource.export.csv : {};
      app.get(`${resourceBase}/export/csv`, async (c) => {
        const auth = await authorize(config, resource, c, undefined, database).catch((err) => {
          logger.event("auth", String(err));
          return errorResponse(String(err), 401, c.get("requestId"));
        });
        if (auth instanceof Response) return auth;
        const denied = await checkPermission(resource, "GET_LIST", auth);
        if (denied) return denied;
        const maxRows = csvOpts.maxRows ?? 10_000;
        const reqDb = c.get("db") ?? database;
        const result = await reqDb.list(resource, {
          filters: new URL(c.req.url).searchParams,
          search: c.req.query("search"),
          sort: c.req.query("sort"),
          page: 1,
          pageSize: maxRows
        });
        const csv = exportToCsv(result.items, resource, csvOpts);
        const filename = getCsvFilename(resource, csvOpts);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`
          }
        });
      });
    }

    // LS-4: Bulk create endpoint
    if (resource.bulk !== undefined || true) { // always mounted; resource.bulk config controls transaction behaviour
      app.post(`${resourceBase}/bulk`, async (c) => {
        if (resource.readOnly) return c.json({ ok: false, error: "Method Not Allowed" }, 405);
        const auth = await authorize(config, resource, c, undefined, database).catch((err) => {
          logger.event("auth", String(err));
          return errorResponse(String(err), 401, c.get("requestId"));
        });
        if (auth instanceof Response) return auth;
        const denied = await checkPermission(resource, "POST", auth);
        if (denied) return denied;
        const requestId = c.get("requestId");
        const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
        const rawRecords: unknown[] = Array.isArray(body.records) ? body.records : [];
        if (rawRecords.length === 0) {
          return c.json({ ok: false, error: "No records provided in body.records" }, 400);
        }
        const audit = buildAudit("POST", new URL(c.req.url).pathname, requestId);
        const transactional = resource.bulk?.transactional !== false;
        const operation = (body.operation as "create" | "update" | "delete") ?? "create";
        const reqDb = c.get("db") ?? database;
        const tenantId = extractTenantIdFromAuth(config, auth);

        if (operation === "delete") {
          const ids = rawRecords.map(String);
          const dbResults = await reqDb.deleteBulk(resource, ids, audit);
          
          let dbIdx = 0;
          const results = ids.map(() => {
            const result = dbResults[dbIdx++]!;
            if (result.success && result.data) {
              resource.hooks?.afterDelete?.(result.data);
              const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "deleted", record: result.data, audit, tenantId };
              events.emit("resource:delete:after", eventPayload);
              realtime.publish(eventPayload);
            }
            return result;
          });
          const userRoles = auth?.roles ?? (auth?.claims?.roles as string[] | undefined) ?? [];
          const filteredResults = results.map(r => r.data ? { ...r, data: filterFieldsByRole(r.data, resource, userRoles) } : r);
          return c.json({ ok: true, results: filteredResults });
        }

        const isUpdate = operation === "update";
        const processedInputs: (Record<string, unknown> | { _error: string })[] = [];
        for (const raw of rawRecords) {
          try {
            const parsedRaw = parseBody(raw);
            const payload = validatePayload(resource, parsedRaw, isUpdate ? "update" : "create");
            const input = isUpdate
              ? (resource.hooks?.beforeUpdate ? await resource.hooks.beforeUpdate({ id: String(parsedRaw.id), input: payload, auth, resource, database: reqDb }) : payload)
              : (resource.hooks?.beforeCreate ? await resource.hooks.beforeCreate({ input: payload, auth, resource, database: reqDb }) : payload);
            if (isUpdate && parsedRaw.id) {
              input.id = parsedRaw.id;
            }
            processedInputs.push(input);
          } catch (err) {
            if (transactional) {
              return c.json({ ok: false, error: `Validation error: ${String(err)}` }, 400);
            }
            processedInputs.push({ _error: String(err) });
          }
        }
        
        const validInputs = processedInputs.filter((r): r is Record<string, unknown> => !("_error" in r));
        const dbResults = isUpdate
          ? await reqDb.updateBulk(resource, validInputs, audit)
          : await reqDb.createBulk(resource, validInputs, audit);
        
        let dbIdx = 0;
        const results = processedInputs.map((r) => {
          if ("_error" in r) return { success: false, error: (r as { _error: string })._error };
          const result = dbResults[dbIdx++]!;
          if (result.success && result.data) {
            if (isUpdate) {
              resource.hooks?.afterUpdate?.(result.data);
              const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "updated", record: result.data, audit, tenantId };
              events.emit("resource:update:after", eventPayload);
              realtime.publish(eventPayload);
            } else {
              resource.hooks?.afterCreate?.(result.data);
              const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "created", record: result.data, audit, tenantId };
              events.emit("resource:create:after", eventPayload);
              realtime.publish(eventPayload);
            }
          }
          return result;
        });
        const userRoles = auth?.roles ?? (auth?.claims?.roles as string[] | undefined) ?? [];
        const filteredResults = results.map(r => r.data ? { ...r, data: filterFieldsByRole(r.data, resource, userRoles) } : r);
        return c.json({ ok: true, results: filteredResults });
      });
    }

    app.post(resourceBase, async (c) => {
      if (resource.readOnly) return c.json({ ok: false, error: "Method Not Allowed" }, 405);
      const auth = await authorize(config, resource, c, undefined, database).catch((err) => {
        logger.event("auth", String(err));
        return errorResponse(String(err), 401, c.get("requestId"));
      });
      if (auth instanceof Response) {
        return auth;
      }
      const denied = await checkPermission(resource, "POST", auth).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : errorResponse(String(err), 403, c.get("requestId"));
      });
      if (denied) return denied;
      const requestId = c.get("requestId");
      const reqDb = c.get("db") ?? database;
      // LS-3: detect multipart uploads for resources with file fields
      let payload: Record<string, unknown>;
      try {
        const contentType = c.req.header("content-type") ?? "";
        if (hasFileFields(resource) && contentType.includes("multipart/form-data")) {
          const fileMap = await handleFileUpload(c, resource, config);
          const rawBody = await c.req.parseBody().catch(() => ({}));
          const textFields: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rawBody)) {
            if (typeof v === "string") textFields[k] = v;
          }
          payload = validatePayload(resource, { ...textFields, ...fileMap }, "create");
        } else {
          payload = validatePayload(resource, parseBody(await c.req.json().catch(() => ({}))), "create");
        }
      } catch (err) {
        return c.json({ ok: false, error: String(err) }, 400);
      }
      const input = resource.hooks?.beforeCreate ? await resource.hooks.beforeCreate({ input: payload, auth, resource, database: reqDb }) : payload;
      const audit = buildAudit("POST", new URL(c.req.url).pathname, requestId);
      const tenantId = extractTenantIdFromAuth(config, auth);
      const beforePayload: ResourceEventPayload = { resource: resource.resource, action: "created", record: input, audit, tenantId };
      events.emit("resource:create:before", beforePayload);
      let record: Record<string, unknown>;
      try {
        record = await reqDb.create(resource, input, audit);
      } catch (err) {
        if (err instanceof LumoraDuplicateError) {
          return c.json({ ok: false, error: err.message }, 409);
        }
        logger.error("db:create", err, requestId);
        return c.json({ ok: false, error: String(err) }, 500);
      }
      await writeAudit(config, reqDb, resource, "create", auth, audit, {}, record, record.id as string);
      await resource.hooks?.afterCreate?.(record);
      const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "created", record, audit, tenantId };
      events.emit("resource:create:after", eventPayload);
      // LS-6: namespaced per-resource event for targeted subscription
      events.emit(`resource:${resource.resource}:afterCreate`, eventPayload);
      realtime.publish(eventPayload);
      const userRoles = auth?.roles ?? (auth?.claims?.roles as string[] | undefined) ?? [];
      return c.json({ ok: true, data: filterFieldsByRole(record, resource, userRoles) }, 201);
    });


    const updateHandler = async (c: Context<{ Variables: AppVariables }>) => {
      if (resource.readOnly || resource.immutable) return c.json({ ok: false, error: "Method Not Allowed" }, 405);
      const method = c.req.method as "PUT" | "PATCH";
      const auth = await authorize(config, resource, c, undefined, database).catch((err) => {
        logger.event("auth", String(err));
        return errorResponse(String(err), 401, c.get("requestId"));
      });
      if (auth instanceof Response) {
        return auth;
      }
      const denied = await checkPermission(resource, method, auth, c.req.param("id")).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : errorResponse(String(err), 403, c.get("requestId"));
      });
      if (denied) return denied;
      const id = c.req.param("id") as string;
      const requestId = c.get("requestId");
      const reqDb = c.get("db") ?? database;
      const existingSnapshot = await reqDb.get(resource, id);
      if (!existingSnapshot) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      // RFC-08: Record-level policy check
      if (resource.permissions?.allowRecord) {
        const allowedRecord = await resource.permissions.allowRecord(auth as LumoraAuthResult, existingSnapshot);
        if (!allowedRecord) {
          return errorResponse("Forbidden", 403, requestId);
        }
      }
      const payload = validatePayload(resource, parseBody(await c.req.json().catch(() => ({}))), "update");
      const input = resource.hooks?.beforeUpdate
        ? await resource.hooks.beforeUpdate({ id, input: payload, auth, resource, database: reqDb })
        : payload;
      const audit = buildAudit(method, new URL(c.req.url).pathname, requestId);
      const tenantId = extractTenantIdFromAuth(config, auth);
      events.emit("resource:update:before", { resource: resource.resource, action: "updated", record: input, audit, tenantId });
      let record: Record<string, unknown> | null;
      try {
        record = await reqDb.update(resource, id, input, audit);
      } catch (err) {
        if (err instanceof LumoraDuplicateError) {
          return c.json({ ok: false, error: err.message }, 409);
        }
        logger.error("db:update", err, requestId);
        return c.json({ ok: false, error: String(err) }, 500);
      }
      if (!record) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      await writeAudit(config, reqDb, resource, "update", auth, audit, existingSnapshot, record, id);
      await resource.hooks?.afterUpdate?.(record);
      const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "updated", record, audit, tenantId };
      events.emit("resource:update:after", eventPayload);
      // LS-6: namespaced per-resource event
      events.emit(`resource:${resource.resource}:afterUpdate`, eventPayload);
      realtime.publish(eventPayload);
      const userRoles = auth?.roles ?? (auth?.claims?.roles as string[] | undefined) ?? [];
      return c.json({ ok: true, data: filterFieldsByRole(record, resource, userRoles) });
    };

    const updateMethod = resource.updateMethod ?? "both";
    if (updateMethod === "put" || updateMethod === "both") {
      app.put(`${resourceBase}/:id`, updateHandler);
    }
    if (updateMethod === "patch" || updateMethod === "both") {
      app.patch(`${resourceBase}/:id`, updateHandler);
    }

    app.delete(`${resourceBase}/:id`, async (c) => {
      if (resource.readOnly || resource.immutable) return c.json({ ok: false, error: "Method Not Allowed" }, 405);
      const auth = await authorize(config, resource, c, undefined, database).catch((err) => {
        logger.event("auth", String(err));
        return errorResponse(String(err), 401, c.get("requestId"));
      });
      if (auth instanceof Response) {
        return auth;
      }
      const id = c.req.param("id");
      const denied = await checkPermission(resource, "DELETE", auth, id).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : errorResponse(String(err), 403, c.get("requestId"));
      });
      if (denied) return denied;
      const requestId = c.get("requestId");
      const reqDb = c.get("db") ?? database;
      if (resource.permissions?.allowRecord) {
        const existing = await reqDb.get(resource, id);
        if (!existing) {
          return c.json({ ok: false, error: "Not found" }, 404);
        }
        const allowedRecord = await resource.permissions.allowRecord(auth as LumoraAuthResult, existing);
        if (!allowedRecord) {
          return errorResponse("Forbidden", 403, requestId);
        }
      }
      const audit = buildAudit("DELETE", new URL(c.req.url).pathname, requestId);
      const tenantId = extractTenantIdFromAuth(config, auth);
      await resource.hooks?.beforeDelete?.({ id, input: {}, auth, resource, database: reqDb });
      events.emit("resource:delete:before", { resource: resource.resource, action: "deleted", audit, tenantId });
      const record = await reqDb.delete(resource, id, audit);
      if (!record) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      await writeAudit(config, reqDb, resource, "delete", auth, audit, record, {}, record.id as string);
      await resource.hooks?.afterDelete?.(record);
      const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "deleted", record, audit, tenantId };
      events.emit("resource:delete:after", eventPayload);
      // LS-6: namespaced per-resource event
      events.emit(`resource:${resource.resource}:afterDelete`, eventPayload);
      realtime.publish(eventPayload);
      const userRoles = auth?.roles ?? (auth?.claims?.roles as string[] | undefined) ?? [];
      return c.json({ ok: true, data: filterFieldsByRole(record, resource, userRoles) });
    });

    if (config.realtime.enabled) {
      app.get(`${resourceBase}/${config.realtime.sseSuffix}`, async (c) => {
        let auth: LumoraAuthResult | undefined;
        try {
          const res = await authorize(config, resource, c, c.req.query("token"), database);
          if (!(res instanceof Response)) {
            auth = res;
          }
        } catch {
          // Handled below by createSseResponse if query-token is required
        }
        const tenantId = extractTenantIdFromAuth(config, auth);
        const resourceScopeDef = resource.permissions?.scope;
        const scopeValue = resourceScopeDef && auth?.scope?.[resourceScopeDef.field];
        const scopeOption = resourceScopeDef && scopeValue !== undefined
          ? { field: resourceScopeDef.field, value: scopeValue }
          : undefined;
        const authOpts: SseAuthOptions = {
          mode: config.auth.mode === "jwt" ? "query-token" : "none",
          tenantId,
          scope: scopeOption
        };
        return realtime.createSseResponse(resource.resource, c as unknown as Context, authOpts);
      });
      app.get(
        `${resourceBase}/${config.realtime.websocketSuffix}`,
        async (c, next) => {
          let tokenOverride: string | undefined;
          const protocols = c.req.header("sec-websocket-protocol");
          if (protocols) {
            tokenOverride = protocols.split(",")[0]?.trim();
          }

          const auth = await authorize(config, resource, c, tokenOverride, database).catch((err) => {
            logger.event("auth", String(err));
            return errorResponse(String(err), 401, c.get("requestId"));
          });
          
          if (auth instanceof Response) {
            return auth;
          }

          const tenantId = extractTenantIdFromAuth(config, auth);
          const resourceScopeDef = resource.permissions?.scope;
          const scopeValue = resourceScopeDef && auth?.scope?.[resourceScopeDef.field];
          const scopeOption = resourceScopeDef && scopeValue !== undefined
            ? { field: resourceScopeDef.field, value: scopeValue }
            : undefined;

          const handler = upgradeWebSocket((c) => ({
            onOpen: (_event, ws) => {
              realtime.attachSocket(resource.resource, ws, { tenantId, scope: scopeOption });
              ws.send(JSON.stringify({ type: "ready", resource: resource.resource, tenantId }));
            },
            onMessage: (event) => {
              const text = typeof event.data === "string" ? event.data : "";
              let message: unknown = text;
              try {
                message = JSON.parse(text);
              } catch {}
              const payload: ResourceEventPayload = {
                resource: resource.resource,
                action: "message",
                message,
                tenantId,
                audit: buildAudit("WS", new URL(c.req.url).pathname, c.get("requestId"))
              };
              events.emit("realtime:message", payload);
              realtime.publish(payload);
            },
            onClose: (_event, ws) => {
              realtime.detachSocket(resource.resource, ws);
            }
          }))(c, next);

          return handler;
        }
      );
    }


    app.get(`${resourceBase}/:id`, async (c) => {
      const auth = await authorize(config, resource, c, undefined, database).catch((err) => {
        logger.event("auth", String(err));
        return errorResponse(String(err), 401, c.get("requestId"));
      });
      if (auth instanceof Response) {
        return auth;
      }
      const denied = await checkPermission(resource, "GET_ONE", auth, c.req.param("id")).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : errorResponse(String(err), 403, c.get("requestId"));
      });
      if (denied) return denied;
      const reqDb = c.get("db") ?? database;
      let record = await reqDb.get(resource, c.req.param("id"));
      if (!record) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      // LS-9: enforce resource scope on GET /:id as well
      const resourceScopeDef = resource.permissions?.scope;
      const scopeValue = resourceScopeDef && auth?.scope?.[resourceScopeDef.field];
      if (resourceScopeDef && scopeValue !== undefined && record[resourceScopeDef.field] !== scopeValue) {
        return errorResponse("Forbidden", 403, c.get("requestId"));
      }
      // RFC-08: Record-level policy check
      if (resource.permissions?.allowRecord) {
        const allowedRecord = await resource.permissions.allowRecord(auth as LumoraAuthResult, record);
        if (!allowedRecord) {
          return errorResponse("Forbidden", 403, c.get("requestId"));
        }
      }
      // LS-1 + LS-2: resolve computed fields and relational includes
      const includeParam = c.req.query("include");
      const includes = includeParam ? includeParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
      if (resource.computed) record = await resolveComputed(record, resource, auth, reqDb);
      if (includes.length > 0) record = await resolveIncludes(record, resource, includes, resources, reqDb);
      const userRoles = auth?.roles ?? (auth?.claims?.roles as string[] | undefined) ?? [];
      return c.json({ ok: true, data: filterFieldsByRole(record, resource, userRoles) });
    });
  }

  const openapi = buildOpenApiDocument(config, resources);
  if (config.docs.enabled) {
    app.get(config.docs.openApiPath, (c) => c.json(openapi));
    app.get(config.docs.path, (c) => c.html(renderDocsUi(config)));
  }

  // LS-3: Serve uploaded files from the configured upload directory
  if (config.upload) {
    const uploadDir = config.upload.dir;
    const serveAt = config.upload.serveAt ?? "/__lumora/uploads";
    app.get(`${serveAt}/:filename`, async (c) => {
      return serveUploadedFile(c.req.param("filename"), uploadDir);
    });
  }

  // RFC-10: Deep liveness + DB readiness probe (/health and /__lumora/health)
  const healthHandler = async (c: Context) => {
    const probeStart = performance.now();
    let dbStatus: "connected" | "disconnected" = "connected";
    try {
      await database.sql.unsafe("SELECT 1");
    } catch {
      dbStatus = "disconnected";
    }
    const latencyMs = Number((performance.now() - probeStart).toFixed(2));
    const healthy = dbStatus === "connected";
    return c.json(
      {
        ok: healthy,
        status: healthy ? "healthy" : "degraded",
        name: config.name,
        version: config.api.version,
        resources: resources.length,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        database: {
          status: dbStatus,
          client: config.database.client,
          latencyMs
        }
      },
      healthy ? 200 : 503
    );
  };
  app.get("/health", healthHandler);
  app.get("/__lumora/health", healthHandler);

  // RFC-10: Request telemetry endpoint (/metrics and /__lumora/metrics)
  app.get("/__lumora/metrics", (c) => {
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const avgLatencyMs = requestsTotal > 0 ? Number((latencySumMs / requestsTotal).toFixed(2)) : 0;
    const accept = c.req.header("accept") ?? "";
    const format = c.req.query("format");

    if (format === "prometheus" || accept.includes("text/plain")) {
      const lines = [
        "# HELP lumora_requests_total Total number of HTTP requests processed.",
        "# TYPE lumora_requests_total counter",
        `lumora_requests_total ${requestsTotal}`,
        "# HELP lumora_errors_total Total number of HTTP 5xx errors.",
        "# TYPE lumora_errors_total counter",
        `lumora_errors_total ${errorsTotal}`,
        "# HELP lumora_request_duration_ms_sum Cumulative request duration in milliseconds.",
        "# TYPE lumora_request_duration_ms_sum counter",
        `lumora_request_duration_ms_sum ${latencySumMs}`,
        "# HELP lumora_uptime_seconds Process uptime in seconds.",
        "# TYPE lumora_uptime_seconds gauge",
        `lumora_uptime_seconds ${uptimeSeconds}`
      ];
      for (const [code, count] of Object.entries(statusCounts)) {
        lines.push(`lumora_http_responses_total{status="${code}"} ${count}`);
      }
      return new Response(lines.join("\n") + "\n", {
        status: 200,
        headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" }
      });
    }

    return c.json({
      ok: true,
      name: config.name,
      uptimeSeconds,
      requestsTotal,
      errorsTotal,
      avgLatencyMs,
      statusCounts
    });
  });

  logger.banner(config, resources);
  events.emit("lifecycle:ready", { resources: resources.map((resource) => resource.resource) });

  // LS-8: start scheduled tasks (Bun.cron-based)
  const schedulerHandle = config.schedule && config.schedule.length > 0
    ? startScheduler(config.schedule, { database, logger })
    : undefined;

  const shutdownHooks: Array<() => Promise<void> | void> = [];

  const instance: LumoraInstance = {
    get apiPrefix() {
      return apiPrefix(config);
    },
    mountModule(modulePath, router, options) {
      const normalizedSub = normalizeResourcePath(modulePath);
      const moduleBase = normalizedSub
        ? `${apiPrefix(config)}/${normalizedSub}`.replace(/\/+/g, "/")
        : apiPrefix(config);

      const attachOnce = (mw: import("hono").MiddlewareHandler) => {
        const seen = new WeakSet<Request>();
        const guarded: import("hono").MiddlewareHandler = async (c, next) => {
          if (seen.has(c.req.raw)) {
            await next();
            return;
          }
          seen.add(c.req.raw);
          return mw(c, next);
        };
        app.use(moduleBase, guarded);
        app.use(`${moduleBase}/*`, guarded);
      };

      if (options?.protected || options?.roles) {
        attachOnce(async (c, next) => {
          const auth = await authorize(config, { kind: "resource", resource: "_module", fields: {} }, c as unknown as Context<{ Variables: AppVariables }>, undefined, database).catch((err) => {
            logger.event("auth", String(err));
            return errorResponse(String(err), 401, c.get("requestId"));
          });
          if (auth instanceof Response) return auth;
          
          if (options.roles && options.roles.length > 0) {
            const userRoles = auth?.roles ?? (auth?.claims?.roles as string[] | undefined) ?? [];
            if (!userRoles.includes("super-admin") && !options.roles.some((r) => userRoles.includes(r))) {
              return errorResponse("Forbidden", 403, c.get("requestId"));
            }
          }
          await next();
        });
      }

      // RFC-04: Apply rate limiting when explicitly configured on mountModule OR inherited from global config.rateLimit
      const rlDisabled =
        options?.rateLimit === false ||
        (typeof options?.rateLimit === "object" && options.rateLimit.disabled === true);
      const shouldRateLimit = !rlDisabled && (Boolean(options?.rateLimit) || config.rateLimit.enabled);

      if (shouldRateLimit) {
        const rlOpts = typeof options?.rateLimit === "object" ? options.rateLimit : {};
        const effectiveMax = rlOpts.max ?? config.rateLimit.max;
        const effectiveWindowMs = rlOpts.windowMs ?? config.rateLimit.windowMs;
        attachOnce(rateLimit({
          limit: effectiveMax,
          windowMs: effectiveWindowMs,
          store: rateLimitStore,
        }));
      }

      if (options?.audit) {
        const hashChain = Boolean(
          config.auditHashChain ||
          config.database.auditHashChain ||
          (typeof options.audit === "object" && options.audit.hashChain)
        );
        attachOnce(async (c, next) => {
          await next();
          if (c.req.method !== "GET" && c.res.status < 400) {
            const auth = c.get("user") as { subject?: string; tenantId?: string } | undefined;
            let action = "update";
            if (c.req.method === "POST") action = "create";
            else if (c.req.method === "DELETE") action = "delete";
            await database.writeAuditLog(
              {
                resource: normalizedSub || "_module",
                action,
                record_id: new URL(c.req.url).pathname,
                actor_subject: auth?.subject ?? "anonymous",
                actor_strategy: "procedural",
                old_value: "{}",
                new_value: "{}",
                request_id: c.get("requestId"),
                request_path: new URL(c.req.url).pathname,
                timestamp: new Date().toISOString(),
                ...(auth?.tenantId ? { tenant_id: auth.tenantId } : {})
              },
              { hashChain }
            ).catch(err => logger.error("audit", err, c.get("requestId")));
          }
        });
      }

      // RFC-07: OpenAPI 3.1.0 Introspection (@hono/zod-openapi + Hono router.routes + manual overrides)
      const defaultTags = options?.openApiTags ?? [normalizedSub || "module"];
      const openApiRouter = router as unknown as {
        getOpenAPI31Document?: (docConfig: { openapi: string; info: { title: string; version: string } }) => {
          paths?: Record<string, Record<string, unknown>>;
          components?: Record<string, unknown>;
        };
        routes?: Array<{ method: string; path: string }>;
      };

      if (typeof openApiRouter.getOpenAPI31Document === "function") {
        try {
          const subDoc = openApiRouter.getOpenAPI31Document({
            openapi: "3.1.0",
            info: { title: config.name, version: config.api.version }
          });
          if (subDoc.paths) {
            for (const [subPath, pathItem] of Object.entries(subDoc.paths)) {
              const fullPath = `${moduleBase}/${subPath.replace(/^\/+/, "")}`.replace(/\/+$/, "") || "/";
              const existing = openapi.paths[fullPath] ?? {};
              const enriched: Record<string, unknown> = {};
              for (const [methodKey, opVal] of Object.entries(pathItem)) {
                if (opVal && typeof opVal === "object") {
                  const opObj = opVal as Record<string, unknown>;
                  enriched[methodKey] = {
                    tags: opObj.tags ?? defaultTags,
                    ...(options?.protected ? { security: [{ bearerAuth: [] }] } : {}),
                    ...opObj
                  };
                }
              }
              openapi.paths[fullPath] = { ...existing, ...enriched };
            }
          }
          if (subDoc.components) {
            openapi.components = {
              ...(openapi.components ?? {}),
              ...subDoc.components
            };
          }
        } catch {
          // Fallback to route table introspection below
        }
      }

      if (Array.isArray(openApiRouter.routes)) {
        for (const r of openApiRouter.routes) {
          const methodUpper = r.method.toUpperCase();
          if (methodUpper === "ALL" || r.path.endsWith("/*")) continue;
          const methodLower = methodUpper.toLowerCase();
          const cleanSub = r.path === "/" ? "" : r.path.replace(/^\/+/, "");
          const rawFullPath = cleanSub ? `${moduleBase}/${cleanSub}` : moduleBase;
          const openApiPath = rawFullPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
          const existingPathItem = openapi.paths[openApiPath] ?? {};
          if (!existingPathItem[methodLower]) {
            existingPathItem[methodLower] = {
              summary: `${methodUpper} ${openApiPath}`,
              tags: defaultTags,
              ...(options?.protected ? { security: [{ bearerAuth: [] }] } : {})
            };
            openapi.paths[openApiPath] = existingPathItem;
          }
        }
      }

      if (options?.openApi?.paths) {
        for (const [customPath, pathItem] of Object.entries(options.openApi.paths)) {
          const fullCustomPath = customPath.startsWith(apiPrefix(config))
            ? customPath
            : `${moduleBase}/${customPath.replace(/^\/+/, "")}`.replace(/\/+$/, "");
          openapi.paths[fullCustomPath] = {
            ...(openapi.paths[fullCustomPath] ?? {}),
            ...pathItem
          };
        }
      }
      if (options?.openApi?.tags) {
        openapi.tags = [...(openapi.tags ?? []), ...options.openApi.tags];
      }

      app.route(moduleBase, router);
      return this;
    },
    shutdown: async () => {
      logger.event("shutdown", "Initiating graceful shutdown...");
      for (const hook of shutdownHooks) {
        try {
          await hook();
        } catch (err) {
          logger.error("shutdown:hook", err, "");
        }
      }
      await instance.close();
    },
    stop: async () => {
      await instance.shutdown();
    },
    onShutdown: (callback) => {
      shutdownHooks.push(callback);
    },
    app,
    fetch: (request, server) => app.fetch(request, { server } as never),
    websocket,
    config,
    events,
    realtime,
    email: emailService,
    ai: aiService,
    docs: {
      openapi,
      path: config.docs.path,
      openApiPath: config.docs.openApiPath
    },
    database,
    scheduler: schedulerHandle,
    // LS-11: structured query executor with access to the resource registry
    query: createQueryExecutor(),
    resources,
    async close() {
      await schedulerHandle?.stop();
      realtime.close();
      await database.close();
      logger.event("close", "lumora instance closed");
      events.emit("lifecycle:close", { name: config.name });
    }
  };
  return instance;
}

export function logAudit(
  db: LumoraDatabase,
  opts: AuditLogOpts,
  options?: { strict?: boolean; hashChain?: boolean }
): Promise<void> | void {
  const write = async () => {
    try {
      await db.writeAuditLog(
        {
          resource: opts.entityType,
          action: opts.action,
          record_id: opts.entityId,
          actor_subject: opts.userId,
          actor_strategy: opts.actorStrategy ?? "procedural",
          old_value: JSON.stringify(opts.before ?? opts.details ?? {}),
          new_value: JSON.stringify(opts.after ?? opts.details ?? {}),
          request_id: crypto.randomUUID(),
          request_path: opts.entityType,
          timestamp: new Date().toISOString(),
          ...(opts.tenantId ? { tenant_id: opts.tenantId } : {})
        },
        { hashChain: options?.hashChain ?? opts.hashChain ?? db.config.auditHashChain }
      );
    } catch (err) {
      if (options?.strict) throw err;
      console.error("[lumora:audit] failed:", (err as Error).message);
    }
  };

  if (options?.strict) {
    return write();
  } else {
    setTimeout(() => {
      write().catch(() => {});
    }, 0);
  }
}

export function createModuleContext(instance: LumoraInstance): LumoraModuleContext {
  return {
    db: instance.database,
    auth: instance.config.auth,
    ai: instance.ai,
    realtime: instance.realtime,
    logAudit: (opts, options) =>
      logAudit(instance.database, opts, {
        ...options,
        hashChain: options?.hashChain ?? opts.hashChain ?? instance.config.auditHashChain ?? instance.config.database.auditHashChain
      }),
  };
}
