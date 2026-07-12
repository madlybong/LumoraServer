# RFC: `@astrake/lumora-server` — Production Usage Feedback & Feature Proposals

**Version targeted:** `0.6.x`
**RFC Date:** 2026-07-12
**Source:** Patterns extracted from a production on-premise healthcare application built on Lumora
**Author:** Internal / Self

---

## Overview

After extensive production use of `@astrake/lumora-server` in a large-scale, multi-module application (15+ procedural modules, 15 `defineResource` resources, on-prem Bun deployment), several recurring patterns and gaps have been identified. This document proposes 6 targeted improvements grounded in real usage, with concrete API designs for each.

Items are ordered by production impact severity.

---

## RFC-01 — `instance.mountModule()` + `instance.apiPrefix` getter

**Severity:** 🔴 Critical  
**Category:** Core API design gap

### Problem

`api: { base, version }` in `defineLumoraConfig()` exclusively prefixes routes registered via `resources: []` (`defineResource`). Routes registered via `instance.app.route()` receive no prefix. This creates **two parallel URL namespaces in one API**, which is invisible in the codebase but breaks every frontend consumer that has to know which category each endpoint belongs to.

**Concrete example from production:**

```
# defineResource (auto-prefixed by Lumora)
GET /api/v1/patients
GET /api/v1/staff-users
GET /api/v1/beds

# Procedural modules (mounted via instance.app.route — no prefix)
POST /auth/login
GET  /billing/invoices
GET  /careipd/admissions/:id
```

This produces:
- Frontend callers using inconsistent paths for semantically identical types of endpoints
- Any tooling that analyses routes (audit tools, API documentation generators, test coverage tools) cannot determine the correct URL for procedural routes without hardcoding them separately
- When a `defineResource` is refactored into a procedural route (or vice versa), all frontend callers must change

### Root Cause

`initLumora()` returns `instance.app` (a Hono app that has already mounted `defineResource` routes under the prefix internally). The app developer then calls `instance.app.route("/billing", ...)` which mounts at the Hono root — not under any prefix. There is no API surface to tell Lumora's `instance.app` to apply the same prefix.

### Proposed API

**Addition 1 — `apiPrefix` getter**

Expose the resolved prefix as a public getter on `LumoraInstance`:

```typescript
// LumoraInstance
get apiPrefix(): string {
  const { base = '', version = '' } = this.config.api ?? {};
  return version ? `${base}/${version}` : base;
}
```

Usage:
```typescript
const prefix = instance.apiPrefix; // "/api/v1"
instance.app.route(`${prefix}/billing`, createBillingRouter(ctx));
```

**Addition 2 — `mountModule()` method (preferred)**

A first-class mounting method that automatically applies `apiPrefix`:

```typescript
// LumoraInstance
mountModule(path: string, router: Hono): this {
  this.app.route(`${this.apiPrefix}${path}`, router);
  return this; // chainable
}
```

Usage:
```typescript
// Before:
instance.app.route("/billing", createBillingRouter(ctx));
instance.app.route("/careipd", createCareIpdRouter(ctx));

// After:
instance.mountModule("/billing", createBillingRouter(ctx));
instance.mountModule("/careipd", createCareIpdRouter(ctx));

// Public routes that should NOT be versioned remain on instance.app:
instance.app.get("/health", ...);
```

**Migration impact:** Zero breaking changes. Fully opt-in. `instance.app.route()` remains available for explicitly unversioned endpoints.

**API design note:** `mountModule()` should also be listed in the module registry (see RFC-03 for how this feeds `createModuleContext`), enabling accurate tooling.

---

## RFC-02 — `defineResource` `updateMethod` Option

**Severity:** 🟠 High  
**Category:** HTTP semantics gap

### Problem

`defineResource` generates `PUT /:id` for UPDATE operations. In standard HTTP semantics (RFC 7396), `PUT` implies full replacement while `PATCH` implies partial update. Because `defineResource` only produces Zod schemas for fields declared in `fields: {}` and applies them as partial updates internally, the actual behaviour is closer to `PATCH`. Frontend applications built with modern REST conventions naturally send `PATCH` for partial updates and hit `404` because the route does not exist.

**Observed pattern in production:**

```typescript
// Frontend sends — correct HTTP semantics:
apiFetch(`/api/v1/departments/${id}`, { method: 'PATCH', body: JSON.stringify(partial) })

// Lumora generates — only this route exists:
PUT /api/v1/departments/:id

// Result: 404
```

Affected resources in one production app: `departments`, `facilities`, `staff-users`, `drug-catalog`, `ipd-charge-catalog`, `suppliers` — all CRUD admin views.

### Proposed API

Add an `updateMethod` option to `defineResource`:

```typescript
export default defineResource({
  resource: 'departments',
  table: 'departments',
  
  // New option (default: 'put' for backward compatibility):
  updateMethod: 'put',    // current behaviour — PUT /:id only
  updateMethod: 'patch',  // modern REST — PATCH /:id only
  updateMethod: 'both',   // generate both PUT /:id and PATCH /:id (transitional)
});
```

**Implementation note:** When `updateMethod` is `'both'` or `'patch'`, the route handler logic is identical — just register the handler on both methods:

```typescript
router.on(['PUT', 'PATCH'], '/:id', updateHandler);
// or separately:
router.put('/:id', updateHandler);
router.patch('/:id', updateHandler);
```

**Default:** Keep `'put'` for `0.6.x` backward compatibility. Consider changing the default to `'both'` in `0.7.x` or `1.0`.

---

## RFC-03 — `createModuleContext()` + `HonoVars` Built-in

**Severity:** 🏆 High  
**Category:** DX / boilerplate elimination

### Problem

Every application using procedural modules alongside `defineResource` must manually build a "module context" object to share Lumora's database, auth config, AI, and realtime instances across routers. This is boilerplate that every Lumora app recreates identically.

**Pattern every app duplicates (verbatim):**

```typescript
// context.ts — identical across every Lumora app
export interface ModuleContext {
  db: LumoraInstance["database"];
  auth: LumoraInstance["config"]["auth"];
  ai?: LumoraInstance["ai"];
  app?: Hono<any>;
  realtime?: LumoraInstance["realtime"];
}

export function createModuleContext(instance: LumoraInstance): ModuleContext {
  return {
    db: instance.database,
    auth: instance.config.auth,
    ai: instance.ai,
    realtime: instance.realtime,
  };
}

// Hono variable typing — also repeated in every module:
export interface HonoVars {
  user: Record<string, unknown>;
  userRole: string;
}
```

### Proposed API

Export `createModuleContext` and a `LumoraModuleContext` type directly from `@astrake/lumora-server`:

```typescript
// @astrake/lumora-server exports:
export interface LumoraModuleContext {
  db: LumoraDatabase;
  auth: LumoraAuthConfig;
  ai?: LumoraAI;
  realtime?: LumoraRealtime;
  logAudit: (opts: AuditLogOpts) => Promise<void>; // see RFC-04
}

export type LumoraHonoVars = {
  user: Record<string, unknown>;
  userRole: string;
};

export function createModuleContext(instance: LumoraInstance): LumoraModuleContext;
```

Usage after:

```typescript
// index.ts — clean, no boilerplate
import { createModuleContext, type LumoraModuleContext } from '@astrake/lumora-server';

const ctx = createModuleContext(instance);
instance.mountModule("/billing", createBillingRouter(ctx));
```

```typescript
// Any module file:
import type { LumoraModuleContext, LumoraHonoVars } from '@astrake/lumora-server';
import { Hono } from 'hono';

export function createBillingRouter(ctx: LumoraModuleContext): Hono<{ Variables: LumoraHonoVars }> {
  // ...
}
```

**Lines eliminated per app:** ~40 lines of `context.ts`. **Lines eliminated per module:** ~5 lines of type imports.

---

## RFC-04 — `logAudit()` Built-in with Structured PII Policy

**Severity:** 🟡 Medium-High  
**Category:** Audit / compliance

### Problem

`defineResource` has `audit: true` which writes to `audit_log` automatically. Procedural modules have no equivalent — every module must implement its own audit logging or import a local utility. In a production app with 15 modules, this results in 15 separate imports and inconsistent audit record formats.

Additionally, there is a critical production pattern that should be enforced at the framework level: audit records must never contain PII (patient names, phone numbers, diagnoses). This constraint is currently enforced only via a code comment in a local file — invisible to new contributors.

**Current local utility (copy-pasted or imported in every module):**

```typescript
// Must be hand-crafted and maintained by the app:
export async function logAudit(db: LumoraDatabase, opts: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>; // SAFE metadata only — NO PII
}): Promise<void> {
  try {
    await db.sql`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
      VALUES (${opts.userId}, ${opts.action}, ${opts.entityType}, ${opts.entityId},
              ${opts.details ? JSON.stringify(opts.details) : null})
    `;
  } catch (err) {
    // Audit failures must not break the primary operation
    console.error("[audit] failed:", (err as Error).message);
  }
}
```

### Proposed API

Export `logAudit` from `@astrake/lumora-server` as a first-class function:

```typescript
// @astrake/lumora-server exports:
export interface AuditLogOpts {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  /** Safe metadata only. PII (names, phone, diagnosis) must NOT be included. */
  details?: Record<string, unknown>;
}

export function logAudit(db: LumoraDatabase, opts: AuditLogOpts): Promise<void>;
```

**Key behaviours that must be guaranteed by the implementation:**
1. **Fire-and-forget with swallowed errors** — audit failure must never throw or reject (cannot break primary operation)
2. **PII warning in JSDoc** — the `details` field JSDoc comment is the enforcement surface
3. **Consistent with `defineResource`'s `audit: true`** — same `audit_log` table schema

**Integration with RFC-03:** `logAudit` should be included in `LumoraModuleContext` as a pre-bound convenience:

```typescript
// After RFC-03 + RFC-04:
const ctx = createModuleContext(instance);

// Inside a route handler:
await ctx.logAudit({
  userId: user.userId,
  action: 'CREATE_VISIT',
  entityType: 'opd_visits',
  entityId: visitId,
  details: { departmentId, tokenNumber } // IDs only, no names
});
```

---

## RFC-05 — Built-in `rateLimit()` Hono Middleware

**Severity:** 🟡 Medium  
**Category:** Security / DX

### Problem

Every procedural module that needs rate limiting must import and configure a custom middleware. In a production app, this means:

- The same in-memory rate limiter is imported in 12+ module files
- Configuration is spread across files with no central policy (`rateLimit(5, 60000)` for login vs `rateLimit(60, 60000)` for read routes)
- The implementation is in-memory only, which means it resets on restart and doesn't work across processes
- No way to express a global rate limit policy in `lumora.config.ts`

**Current pattern (12+ occurrences across modules):**

```typescript
import { rateLimit } from '../../middleware/rate-limit';
// ...
router.use('*', rateLimit(60, 60_000), authMiddleware);
router.post('/login', rateLimit(5, 60 * 1000), loginHandler);
```

### Proposed API

**Option A — Export built-in middleware:**

```typescript
// @astrake/lumora-server exports:
export function rateLimit(opts: {
  limit: number;
  windowMs: number;
  keyFn?: (c: Context) => string; // default: x-forwarded-for header
}): MiddlewareHandler;
```

**Option B — Config-level rate limit policy (preferred):**

```typescript
// lumora.config.ts:
export default defineLumoraConfig({
  // ...
  rateLimit: {
    global: { limit: 100, windowMs: 60_000 },
    routes: [
      { pattern: '/auth/login', limit: 5, windowMs: 60_000 },
      { pattern: '/ai/*', limit: 10, windowMs: 60_000 },
    ]
  }
});
```

Lumora then applies rate limiting automatically to all routes (resource + procedural via `mountModule`) with per-route overrides.

**Note on implementation:** The current in-memory implementation is not cluster-safe. Lumora's implementation should at minimum document this limitation; an optional `store: 'memory' | 'db'` option would allow using the existing Postgres connection pool as a distributed counter without adding Redis as a dependency.

---

## RFC-06 — `mountModule()` SSE Route Auth (JWT via Query Param)

**Severity:** 🟡 Medium  
**Category:** Realtime / DX

### Problem

Lumora provides SSE realtime via `realtimeHub.createSseResponse(channel)`. However, browser `EventSource` cannot send custom headers (including `Authorization: Bearer <token>`). The only standard mechanism is a JWT in the URL query string (`?token=<jwt>`). Every Lumora app that uses SSE must implement this auth pattern manually:

```typescript
// Current: hand-rolled JWT-in-query-param SSE auth in every SSE route:
router.get("/realtime/queue", async (c) => {
  const qToken = c.req.query("token");
  if (!qToken) return c.json({ error: "Unauthorized" }, 401);
  try {
    await verify(qToken, process.env.JWT_SECRET || "...", "HS256");
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!realtimeHub) return c.json({ error: "Realtime not enabled" }, 503);
  return (realtimeHub as any).createSseResponse("opd-queue");
});
```

This requires: `import { verify } from "hono/jwt"` + accessing `JWT_SECRET` + knowing the internal casting hack `(realtimeHub as any)`.

### Proposed API

`createSseResponse` should accept an auth configuration:

```typescript
// @astrake/lumora-server — updated LumoraRealtime:
interface SseOptions {
  auth?: {
    mode: 'bearer-header';            // standard Authorization header (current default)
  } | {
    mode: 'query-token';              // for EventSource/SSE browser clients
    secret?: string;                  // if omitted, use instance auth.secret
  } | {
    mode: 'none';                     // explicitly unauthenticated
  };
}

realtimeHub.createSseResponse(channel: string, options?: SseOptions): Response;
```

Usage:
```typescript
router.get("/realtime/queue", async (c) => {
  return realtimeHub.createSseResponse("opd-queue", {
    auth: { mode: 'query-token' }
  });
});
```

Lumora handles the `?token=` extraction and verification internally using the configured `auth.secret`.

---

## Appendix — Quick-Reference Table

| RFC | Feature | Severity | Breaking? | Est. Effort |
|---|---|---|---|---|
| RFC-01 | `mountModule()` + `apiPrefix` getter | 🔴 Critical | No | Small |
| RFC-02 | `defineResource` `updateMethod` option | 🟠 High | No (default unchanged) | Small |
| RFC-03 | `createModuleContext()` + `LumoraHonoVars` export | 🟡 Med-High | No | Small |
| RFC-04 | `logAudit()` built-in + `AuditLogOpts` type | 🟡 Med-High | No | Small |
| RFC-05 | Built-in `rateLimit()` middleware / config policy | 🟡 Medium | No | Medium |
| RFC-06 | SSE `auth: { mode: 'query-token' }` option | 🟡 Medium | No | Medium |

**RFC-01 is the most impactful.** It resolves a structural API design gap that affects all tooling, all frontend consumers, and all multi-module applications built on Lumora. RFCs 03 and 04 are trivially small exports that eliminate significant boilerplate.

---

## Version Targeting

| RFC | Target Version |
|---|---|
| RFC-01 `apiPrefix` getter | `0.6.x` patch — zero breaking |
| RFC-01 `mountModule()` | `0.7.0` |
| RFC-02 `updateMethod` | `0.7.0` |
| RFC-03 `createModuleContext` | `0.7.0` |
| RFC-04 `logAudit` | `0.7.0` |
| RFC-05 `rateLimit` middleware | `0.8.0` (config-level policy) |
| RFC-06 SSE query-token auth | `0.8.0` |
