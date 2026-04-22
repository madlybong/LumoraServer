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
import type {
  DefineResourceResult,
  LumoraConfig,
  LumoraEventMap,
  LumoraInstance,
  RequestAudit,
  ResourceEventPayload,
  ResolvedLumoraConfig
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

export async function initLumora(configOrPath: LumoraConfig | string): Promise<LumoraInstance> {
  const config = await loadLumoraConfig(configOrPath);
  const events = new LumoraEventEmitter<LumoraEventMap>();
  const realtime = new LumoraRealtimeHub();
  const database = new LumoraDatabase(config.database, events);
  const resources = await loadResources(config);
  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    await next();
  });

  await database.connect();
  events.emit("lifecycle:init", { config });

  for (const resource of resources) {
    await database.ensureResource(resource);
    const resourceBase = `${apiPrefix(config)}/${normalizeResourcePath(resource.resource)}`.replace(/\/+/g, "/");

    app.get(resourceBase, async (c) => {
      const auth = await authorizeOrRespond(config, resource, c);
      if (auth instanceof Response) {
        return auth;
      }
      const page = Number(c.req.query("page") ?? 1);
      const pageSize = Math.min(
        Number(c.req.query("pageSize") ?? resource.query?.defaultPageSize ?? 20),
        resource.query?.maxPageSize ?? 100
      );
      const result = await database.list(resource, {
        filters: new URL(c.req.url).searchParams,
        sort: c.req.query("sort"),
        page,
        pageSize
      });
      return c.json({ ok: true, data: result, auth });
    });

    app.post(resourceBase, async (c) => {
      const auth = await authorizeOrRespond(config, resource, c);
      if (auth instanceof Response) {
        return auth;
      }
      const requestId = c.get("requestId");
      const payload = validatePayload(resource, parseBody(await c.req.json().catch(() => ({}))), "create");
      const input = resource.hooks?.beforeCreate ? await resource.hooks.beforeCreate({ input: payload, auth, resource }) : payload;
      const audit = buildAudit("POST", new URL(c.req.url).pathname, requestId);
      const beforePayload: ResourceEventPayload = { resource: resource.resource, action: "created", record: input, audit };
      events.emit("resource:create:before", beforePayload);
      const record = await database.create(resource, input, audit);
      await resource.hooks?.afterCreate?.(record);
      const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "created", record, audit };
      events.emit("resource:create:after", eventPayload);
      realtime.publish(eventPayload);
      return c.json({ ok: true, data: record }, 201);
    });

    app.put(`${resourceBase}/:id`, async (c) => {
      const auth = await authorizeOrRespond(config, resource, c);
      if (auth instanceof Response) {
        return auth;
      }
      const requestId = c.get("requestId");
      const payload = validatePayload(resource, parseBody(await c.req.json().catch(() => ({}))), "update");
      const input = resource.hooks?.beforeUpdate
        ? await resource.hooks.beforeUpdate({ id: c.req.param("id"), input: payload, auth, resource })
        : payload;
      const audit = buildAudit("PUT", new URL(c.req.url).pathname, requestId);
      events.emit("resource:update:before", { resource: resource.resource, action: "updated", record: input, audit });
      const record = await database.update(resource, c.req.param("id"), input, audit);
      if (!record) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      await resource.hooks?.afterUpdate?.(record);
      const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "updated", record, audit };
      events.emit("resource:update:after", eventPayload);
      realtime.publish(eventPayload);
      return c.json({ ok: true, data: record });
    });

    app.delete(`${resourceBase}/:id`, async (c) => {
      const auth = await authorizeOrRespond(config, resource, c);
      if (auth instanceof Response) {
        return auth;
      }
      const requestId = c.get("requestId");
      const audit = buildAudit("DELETE", new URL(c.req.url).pathname, requestId);
      await resource.hooks?.beforeDelete?.({ id: c.req.param("id"), input: {}, auth, resource });
      events.emit("resource:delete:before", { resource: resource.resource, action: "deleted", audit });
      const record = await database.delete(resource, c.req.param("id"), audit);
      if (!record) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      await resource.hooks?.afterDelete?.(record);
      const eventPayload: ResourceEventPayload = { resource: resource.resource, action: "deleted", record, audit };
      events.emit("resource:delete:after", eventPayload);
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
      const auth = await authorizeOrRespond(config, resource, c);
      if (auth instanceof Response) {
        return auth;
      }
      const record = await database.get(resource, c.req.param("id"));
      if (!record) {
        return c.json({ ok: false, error: "Not found" }, 404);
      }
      return c.json({ ok: true, data: record });
    });
  }

  const openapi = buildOpenApiDocument(config, resources);
  if (config.docs.enabled) {
    app.get(config.docs.openApiPath, (c) => c.json(openapi));
    app.get(config.docs.path, (c) => c.html(renderDocsUi(config)));
  }

  app.get("/health", (c) => c.json({ ok: true, name: config.name, resources: resources.length }));

  events.emit("lifecycle:ready", { resources: resources.map((resource) => resource.resource) });

  return {
    app,
    fetch: (request, server) => app.fetch(request, { server } as never),
    websocket,
    config,
    events,
    realtime,
    docs: {
      openapi,
      path: config.docs.path,
      openApiPath: config.docs.openApiPath
    },
    async close() {
      await database.close();
      events.emit("lifecycle:close", { name: config.name });
    }
  };
}
