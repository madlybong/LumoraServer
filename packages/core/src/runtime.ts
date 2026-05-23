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
import { startScheduler } from "./scheduler";
import { createQueryExecutor } from "./query";
import { LumoraMigrationEngine } from "./migrations";

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
  ResourceExportCsvOptions
} from "./types";

type AppVariables = {
  requestId: string;
};

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

async function authorize(
  config: ResolvedLumoraConfig,
  resource: DefineResourceResult,
  c: Context<{ Variables: AppVariables }>
) {
  const mode = resource.auth?.mode ?? "inherit";
  if (mode === "public") {
    return undefined;
  }
  if (config.mode !== "production" && config.auth.mode === "disabled") {
    return undefined;
  }
  return resolveAuthFromContext(c as any, config.auth);
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

export async function initLumora(configOrPath: LumoraConfig | string): Promise<LumoraInstance> {
  const config = await loadLumoraConfig(configOrPath);
  const events = new LumoraEventEmitter<LumoraEventMap>();
  const realtime = new LumoraRealtimeHub();
  const database = new LumoraDatabase(config.database, events);
  const resources: DefineResourceResult[] = config.resources
    ? config.resources
    : config.routes
      ? await loadResources(config)
      : [];

  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const app = new Hono<{ Variables: AppVariables }>();
  const logger = new LumoraLogger(config.logging.level);

  app.use("*", async (c, next) => {
    const { origin, methods, headers, credentials } = config.cors;
    const requestOrigin = c.req.header("origin") ?? "";
    const allowed = origin === "*"
      || (Array.isArray(origin) ? origin.includes(requestOrigin) : requestOrigin === origin);
    if (allowed && origin) {
      c.header("Access-Control-Allow-Origin", Array.isArray(origin) ? requestOrigin : origin as string);
    }
    c.header("Access-Control-Allow-Methods", methods.join(", "));
    c.header("Access-Control-Allow-Headers", headers.join(", "));
    if (credentials) c.header("Access-Control-Allow-Credentials", "true");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    const start = Date.now();
    await next();
    logger.request(c.req.method, new URL(c.req.url).pathname, c.res.status, Date.now() - start, requestId);
  });

  await database.connect();
  await database.ensureAuditTable();

  // Migration engine — mode-aware (auto in dev, strict in prod, off in test)
  const migrationEngine = new LumoraMigrationEngine(database, config, logger);
  await migrationEngine.run();

  const emailService = config.email
    ? createEmailService(config.email, database.sql)
    : undefined;

  const aiService = config.ai
    ? createAIService(config.ai, database.sql)
    : undefined;

  logger.event("init", "starting lumora instance...");
  events.emit("lifecycle:init", { config });

  for (const resource of resources) {
    await database.ensureResource(resource);
    const resourceBase = `${apiPrefix(config)}/${normalizeResourcePath(resource.resource)}`.replace(/\/+/g, "/");

    app.get(resourceBase, async (c) => {
      const auth = await authorize(config, resource, c).catch((err) => {
        // Auth errors (expired tokens, bad credentials) are expected user-level errors; log verbosely only
        logger.event("auth", String(err));
        return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 401, headers: { "Content-Type": "application/json" } });
      });
      if (auth instanceof Response) {
        return auth;
      }
      const denied = await checkPermission(resource, "GET_LIST", auth).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 403, headers: { "Content-Type": "application/json" } });
      });
      if (denied) return denied;
      const page = Number(c.req.query("page") ?? 1);
      const rawPageSize = c.req.query("pageSize") ?? c.req.query("limit");
      const pageSize = Math.min(
        Number(rawPageSize ?? resource.query?.defaultPageSize ?? 20),
        resource.query?.maxPageSize ?? 100
      );
      // LS-9: extract scope from auth for store-scoped resources
      const resourceScopeDef = resource.permissions?.scope;
      const scopeValue = resourceScopeDef && auth?.scope?.[resourceScopeDef.field];
      const scopeOption = resourceScopeDef && scopeValue !== undefined
        ? { field: resourceScopeDef.field, value: scopeValue }
        : undefined;
      const result = await database.list(resource, {
        filters: new URL(c.req.url).searchParams,
        search: c.req.query("search"),
        sort: c.req.query("sort"),
        page,
        pageSize,
        scope: scopeOption
      });

      // LS-1 + LS-2: resolve computed fields and relational includes
      const includeParam = c.req.query("include");
      const includes = includeParam ? includeParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
      let items = result.items;
      if (resource.computed || includes.length > 0) {
        items = await Promise.all(
          items.map(async (record) => {
            let r = record;
            if (resource.computed) r = await resolveComputed(r, resource, auth, database);
            if (includes.length > 0) r = await resolveIncludes(r, resource, includes, resources, database);
            return r;
          })
        );
      }
      return c.json({ ok: true, data: items, total: result.total, page: result.page, pageSize: result.pageSize });
    });

    // LS-5: CSV export endpoint (only if resource declares export.csv)
    if (resource.export?.csv) {
      const csvOpts: ResourceExportCsvOptions = typeof resource.export.csv === "object" ? resource.export.csv : {};
      app.get(`${resourceBase}/export/csv`, async (c) => {
        const auth = await authorize(config, resource, c).catch((err) => {
          logger.event("auth", String(err));
          return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 401, headers: { "Content-Type": "application/json" } });
        });
        if (auth instanceof Response) return auth;
        const denied = await checkPermission(resource, "GET_LIST", auth);
        if (denied) return denied;
        // Export up to 10,000 records with any active filters/search applied
        const result = await database.list(resource, {
          filters: new URL(c.req.url).searchParams,
          search: c.req.query("search"),
          sort: c.req.query("sort"),
          page: 1,
          pageSize: 10000
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
        const auth = await authorize(config, resource, c).catch((err) => {
          logger.event("auth", String(err));
          return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 401, headers: { "Content-Type": "application/json" } });
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
        // Validate all records first (outside DB transaction)
        const processedInputs: (Record<string, unknown> | { _error: string })[] = [];
        for (const raw of rawRecords) {
          try {
            const payload = validatePayload(resource, parseBody(raw), "create");
            const input = resource.hooks?.beforeCreate
              ? await resource.hooks.beforeCreate({ input: payload, auth, resource, database })
              : payload;
            processedInputs.push(input);
          } catch (err) {
            if (transactional) {
              return c.json({ ok: false, error: `Validation error: ${String(err)}` }, 400);
            }
            processedInputs.push({ _error: String(err) });
          }
        }
        // Separate valid records from pre-validation errors (non-transactional only)
        const validInputs = processedInputs.filter((r): r is Record<string, unknown> => !("_error" in r));
        const dbResults = await database.createBulk(resource, validInputs, audit);
        // Merge pre-validation errors back with DB results for non-transactional mode
        let dbIdx = 0;
        const results = processedInputs.map((r) => {
          if ("_error" in r) return { success: false, error: (r as { _error: string })._error };
          const result = dbResults[dbIdx++]!;
          if (result.success && result.data) {
            // Fire afterCreate and events for each successful record
            resource.hooks?.afterCreate?.(result.data);
            const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "created", record: result.data, audit };
            events.emit("resource:create:after", eventPayload);
            realtime.publish(eventPayload);
          }
          return result;
        });
        return c.json({ ok: true, results });
      });
    }

    app.post(resourceBase, async (c) => {
      const auth = await authorize(config, resource, c).catch((err) => {
        logger.event("auth", String(err));
        return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 401, headers: { "Content-Type": "application/json" } });
      });
      if (auth instanceof Response) {
        return auth;
      }
      const denied = await checkPermission(resource, "POST", auth).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 403, headers: { "Content-Type": "application/json" } });
      });
      if (denied) return denied;
      const requestId = c.get("requestId");
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
      const input = resource.hooks?.beforeCreate ? await resource.hooks.beforeCreate({ input: payload, auth, resource, database }) : payload;
      const audit = buildAudit("POST", new URL(c.req.url).pathname, requestId);
      const beforePayload: ResourceEventPayload = { resource: resource.resource, action: "created", record: input, audit };
      events.emit("resource:create:before", beforePayload);
      let record: Record<string, unknown>;
      try {
        record = await database.create(resource, input, audit);
      } catch (err) {
        logger.error("db:create", err, requestId);
        return c.json({ ok: false, error: String(err) }, 500);
      }
      await writeAudit(database, resource, "create", auth, audit, {}, record, record.id as string);
      await resource.hooks?.afterCreate?.(record);
      const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "created", record, audit };
      events.emit("resource:create:after", eventPayload);
      // LS-6: namespaced per-resource event for targeted subscription
      events.emit(`resource:${resource.resource}:afterCreate`, eventPayload);
      realtime.publish(eventPayload);
      return c.json({ ok: true, data: record }, 201);
    });


    app.put(`${resourceBase}/:id`, async (c) => {
      const auth = await authorize(config, resource, c).catch((err) => {
        logger.event("auth", String(err));
        return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 401, headers: { "Content-Type": "application/json" } });
      });
      if (auth instanceof Response) {
        return auth;
      }
      const denied = await checkPermission(resource, "PUT", auth, c.req.param("id")).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 403, headers: { "Content-Type": "application/json" } });
      });
      if (denied) return denied;
      const requestId = c.get("requestId");
      const payload = validatePayload(resource, parseBody(await c.req.json().catch(() => ({}))), "update");
      const input = resource.hooks?.beforeUpdate
        ? await resource.hooks.beforeUpdate({ id: c.req.param("id"), input: payload, auth, resource, database })
        : payload;
      const audit = buildAudit("PUT", new URL(c.req.url).pathname, requestId);
      const existingSnapshot = await database.get(resource, c.req.param("id")) || {};
      events.emit("resource:update:before", { resource: resource.resource, action: "updated", record: input, audit });
      const record = await database.update(resource, c.req.param("id"), input, audit);
      if (!record) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      await writeAudit(database, resource, "update", auth, audit, existingSnapshot, record, c.req.param("id"));
      await resource.hooks?.afterUpdate?.(record);
      const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "updated", record, audit };
      events.emit("resource:update:after", eventPayload);
      // LS-6: namespaced per-resource event
      events.emit(`resource:${resource.resource}:afterUpdate`, eventPayload);
      realtime.publish(eventPayload);
      return c.json({ ok: true, data: record });
    });

    app.patch(`${resourceBase}/:id`, async (c) => {
      const auth = await authorize(config, resource, c).catch((err) => {
        logger.event("auth", String(err));
        return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 401, headers: { "Content-Type": "application/json" } });
      });
      if (auth instanceof Response) {
        return auth;
      }
      const denied = await checkPermission(resource, "PATCH", auth, c.req.param("id")).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 403, headers: { "Content-Type": "application/json" } });
      });
      if (denied) return denied;
      const requestId = c.get("requestId");
      const payload = validatePayload(resource, parseBody(await c.req.json().catch(() => ({}))), "update");
      const input = resource.hooks?.beforeUpdate
        ? await resource.hooks.beforeUpdate({ id: c.req.param("id"), input: payload, auth, resource, database })
        : payload;
      const audit = buildAudit("PATCH", new URL(c.req.url).pathname, requestId);
      const existingSnapshot = await database.get(resource, c.req.param("id")) || {};
      events.emit("resource:update:before", { resource: resource.resource, action: "updated", record: input, audit });
      const record = await database.update(resource, c.req.param("id"), input, audit);
      if (!record) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      await writeAudit(database, resource, "update", auth, audit, existingSnapshot, record, c.req.param("id"));
      await resource.hooks?.afterUpdate?.(record);
      const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "updated", record, audit };
      events.emit("resource:update:after", eventPayload);
      // LS-6: namespaced per-resource event
      events.emit(`resource:${resource.resource}:afterUpdate`, eventPayload);
      realtime.publish(eventPayload);
      return c.json({ ok: true, data: record });
    });

    app.delete(`${resourceBase}/:id`, async (c) => {
      const auth = await authorize(config, resource, c).catch((err) => {
        logger.event("auth", String(err));
        return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 401, headers: { "Content-Type": "application/json" } });
      });
      if (auth instanceof Response) {
        return auth;
      }
      const denied = await checkPermission(resource, "DELETE", auth, c.req.param("id")).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 403, headers: { "Content-Type": "application/json" } });
      });
      if (denied) return denied;
      const requestId = c.get("requestId");
      const audit = buildAudit("DELETE", new URL(c.req.url).pathname, requestId);
      await resource.hooks?.beforeDelete?.({ id: c.req.param("id"), input: {}, auth, resource, database });
      events.emit("resource:delete:before", { resource: resource.resource, action: "deleted", audit });
      const record = await database.delete(resource, c.req.param("id"), audit);
      if (!record) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      await writeAudit(database, resource, "delete", auth, audit, record, {}, record.id as string);
      await resource.hooks?.afterDelete?.(record);
      const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "deleted", record, audit };
      events.emit("resource:delete:after", eventPayload);
      // LS-6: namespaced per-resource event
      events.emit(`resource:${resource.resource}:afterDelete`, eventPayload);
      realtime.publish(eventPayload);
      return c.json({ ok: true, data: record });
    });

    app.get(`${resourceBase}/${config.realtime.sseSuffix}`, (c) => realtime.createSseResponse(resource.resource));
    app.get(
      `${resourceBase}/${config.realtime.websocketSuffix}`,
      upgradeWebSocket((c) => ({
        onOpen: (_event, ws) => {
          realtime.attachSocket(resource.resource, ws);
          ws.send(JSON.stringify({ type: "ready", resource: resource.resource }));
        },
        onMessage: (event, ws) => {
          const text = typeof event.data === "string" ? event.data : "";
          let message: unknown = text;
          try {
            message = JSON.parse(text);
          } catch {}
          const payload: ResourceEventPayload = {
            resource: resource.resource,
            action: "message",
            message,
            audit: buildAudit("WS", new URL(c.req.url).pathname, c.get("requestId"))
          };
          events.emit("realtime:message", payload);
          realtime.publish(payload);
        },
        onClose: (_event, ws) => {
          realtime.detachSocket(resource.resource, ws);
        }
      }))
    );

    app.get(`${resourceBase}/:id`, async (c) => {
      const auth = await authorize(config, resource, c).catch((err) => {
        logger.event("auth", String(err));
        return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 401, headers: { "Content-Type": "application/json" } });
      });
      if (auth instanceof Response) {
        return auth;
      }
      const denied = await checkPermission(resource, "GET_ONE", auth, c.req.param("id")).catch((err) => {
        logger.error("permit", err, c.get("requestId"));
        return err instanceof Response ? err : new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 403, headers: { "Content-Type": "application/json" } });
      });
      if (denied) return denied;
      let record = await database.get(resource, c.req.param("id"));
      if (!record) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      // LS-1 + LS-2: resolve computed fields and relational includes
      const includeParam = c.req.query("include");
      const includes = includeParam ? includeParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
      if (resource.computed) record = await resolveComputed(record, resource, auth, database);
      if (includes.length > 0) record = await resolveIncludes(record, resource, includes, resources, database);
      return c.json({ ok: true, data: record });
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

  app.get("/health", (c) => c.json({ ok: true, name: config.name, resources: resources.length }));

  logger.banner(config, resources);
  events.emit("lifecycle:ready", { resources: resources.map((resource) => resource.resource) });

  // LS-8: start scheduled tasks (Bun.cron-based)
  const schedulerHandle = config.schedule && config.schedule.length > 0
    ? startScheduler(config.schedule, { database, logger })
    : undefined;

  return {
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
      schedulerHandle?.stop();
      await database.close();
      logger.event("close", "lumora instance closed");
      events.emit("lifecycle:close", { name: config.name });
    }
  };
}

