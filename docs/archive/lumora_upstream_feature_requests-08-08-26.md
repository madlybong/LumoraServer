# @astrake/lumora-server — Upstream Feature Requests & Bug Reports

**Framework:** `@astrake/lumora-server`  
**Version tested:** `^0.6.3`  
**Submitted by:** Enterprise consumer (production multi-module application)  
**Date:** 2026-08-08  

---

## Context

This document was prepared after running `@astrake/lumora-server` in a production, multi-module, multi-tenant application serving a regulated industry. The issues below were discovered through real-world use — not theoretical analysis. Each item is grounded in observed behavior or a demonstrable gap in the current framework surface area.

The requests are grouped into three tiers:

- **🔴 Critical** — Active security vulnerabilities or data loss scenarios
- **🟠 High** — Missing features that are essential for enterprise / regulated deployments
- **🟡 Medium** — Developer experience gaps that degrade correctness and maintainability

---

## 🔴 CRITICAL ISSUES

---

### [SECURITY] FR-01 — `rateLimit()` Is Unsafe for Production: In-Memory Store Is Not Cluster-Aware

**Category:** Security — Authentication bypass  
**Affects:** All consumers using `rateLimit()` for login protection or abuse prevention

#### Problem

The `rateLimit()` middleware exported by `@astrake/lumora-server` uses an **in-memory `Map`** as its counter store. This is fundamentally broken in any production deployment:

1. **Single process**: Counters reset on every server restart. A restarted server immediately gives every IP a fresh window.
2. **Multi-worker / clustered**: Each worker process has its own isolated `Map`. A caller can round-robin across workers and trivially bypass any per-IP limit. A 5 req/min login rate limit applied with `rateLimit({ limit: 5, windowMs: 60_000 })` is completely non-functional in a cluster.
3. **Edge runtimes / serverless**: Completely ineffective — no state persists between invocations.

For any route protecting against brute-force (e.g., login endpoints), the in-memory rate limiter provides **zero protection** in production.

#### Expected Behavior

Rate limit counters must be consistent across all processes/workers serving the same application.

#### Proposed Solution

Introduce a pluggable `store` interface for `rateLimit()`:

```typescript
interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  reset(key: string): Promise<void>;
}

// Usage
rateLimit({
  limit: 5,
  windowMs: 60_000,
  store: new PostgresRateLimitStore(db),   // built-in adapter
  // store: new RedisRateLimitStore(redis), // built-in adapter
  // store: undefined,                      // defaults to in-memory (clearly documented as dev-only)
})
```

**Built-in adapters needed:**
- `PostgresRateLimitStore(db)` — uses a single table (`lumora_rate_limits`) with row-level locking
- In-memory default — acceptable only if accompanied by a prominent console warning in non-test environments:
  > `[lumora] WARNING: rateLimit() is using the in-memory store. This is not safe for clustered or production deployments. Pass a persistent store adapter.`

**Acceptance Criteria:**
- [ ] `rateLimit()` accepts an optional `store` parameter implementing a documented interface
- [ ] An in-memory store is the default but emits a warning in `production` mode
- [ ] A PostgreSQL store adapter is shipped with the framework
- [ ] Documentation clearly states in-memory is not cluster-safe

---

### [SECURITY] FR-02 — `resolveAuthFromContext` JWT Expiry Enforcement Is Undocumented and Untestable

**Category:** Security — Possible token reuse after expiry  
**Affects:** All consumers using `resolveAuthFromContext` in procedural modules

#### Problem

`resolveAuthFromContext(c, config.auth)` is the primary auth guard for procedural routes. Its internal JWT verification logic is opaque — there is no public documentation confirming that it enforces the `exp` claim on every code path.

In practice, consumers who need high-assurance security on sensitive routes (admin-level, financial, clinical) end up **re-implementing JWT verification manually** to explicitly check `exp`, because they cannot trust that `resolveAuthFromContext` does so reliably. This leads to duplicated, divergent auth logic across a codebase.

Additionally, there is no exported utility that consumers can use to write unit tests verifying that expired tokens are rejected on their own routes.

#### Expected Behavior

- `resolveAuthFromContext` **always** returns `null` (or throws) if the token's `exp` is in the past, regardless of whether the signature is valid.
- This behavior is explicitly tested in the framework's own test suite.
- A testable utility is exported for consumers.

#### Proposed Solution

1. **Document** that `resolveAuthFromContext` enforces `exp`. Add it to the JSDoc on the function.

2. **Export a testable utility:**

```typescript
// New export
export function verifyLumoraJwt(
  token: string,
  secret: string
): Promise<{ claims: Record<string, unknown> } | null>
```

This allows consumers to write their own tests:

```typescript
it("should reject expired tokens", async () => {
  const expiredToken = signJwt({ sub: "123", exp: 0 }, secret);
  const result = await verifyLumoraJwt(expiredToken, secret);
  expect(result).toBeNull();
});
```

3. Consider adding an `auth.clockSkewSeconds` config option for deployments where server clocks may drift slightly.

**Acceptance Criteria:**
- [ ] JSDoc on `resolveAuthFromContext` explicitly states it enforces `exp`
- [ ] Framework test suite includes a test: expired token → `resolveAuthFromContext` returns null
- [ ] `verifyLumoraJwt(token, secret)` is exported from the public API

---

### [SECURITY] FR-03 — CORS Config Is Incomplete: Consumers Are Forced to Register Conflicting Middleware

**Category:** Security — CORS misconfiguration leading to credential exposure  
**Affects:** All consumers using `cors` in `defineLumoraConfig`

#### Problem

The `cors` block in `defineLumoraConfig` does not expose sufficient control over `allowHeaders` and `allowMethods`. When a consumer needs to allow headers that Lumora does not include by default (e.g., `Authorization`, custom `X-*` headers, or `PATCH` as an allowed method), they are forced to register a second `hono/cors` middleware on `instance.app`.

This second middleware inevitably overrides Lumora's internal CORS headers — usually with a more permissive configuration (e.g., `origin: '*'`) — **completely defeating the strict origin allowlist** that was set in `defineLumoraConfig`.

This is a security regression caused by an incomplete API surface: the user's *intent* is to restrict origins, but the *only workaround* for adding missing headers breaks that intent.

#### Current Workaround (Insecure)

```typescript
// Lumora config sets restrictive origins
cors: { origin: ['https://app.example.com'], credentials: true }

// ...but consumer is forced to add this to get PATCH and Authorization:
instance.app.use('*', cors({
  origin: '*',          // ← opens up all origins
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
```

#### Proposed Solution

Make the `cors` config block fully configurable:

```typescript
cors: {
  origin: string | string[] | ((origin: string) => boolean),
  credentials?: boolean,
  allowHeaders?: string[],          // NEW — merged with Lumora's defaults
  allowMethods?: string[],          // NEW — merged with Lumora's defaults  
  exposeHeaders?: string[],         // NEW
  maxAge?: number,                  // NEW
  passthrough?: boolean,            // NEW — disables Lumora's CORS entirely; consumer handles it
}
```

Additionally, document which headers and methods Lumora sets by default so consumers know what they are inheriting.

**Acceptance Criteria:**
- [ ] `cors.allowHeaders` in config is respected and merged with framework defaults
- [ ] `cors.allowMethods` in config is respected and merged with framework defaults
- [ ] `cors.passthrough: true` disables Lumora's CORS middleware entirely
- [ ] Docs list every CORS header the framework sets automatically

---

### [DATA INTEGRITY] FR-04 — `defineResource` Has No Immutable or Read-Only Mode

**Category:** Security / Data Integrity — Regulatory compliance  
**Affects:** Any consumer using `defineResource` for append-only or read-only data (audit logs, ledgers, event stores, etc.)

#### Problem

`defineResource` generates a full REST CRUD surface: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`. There is no built-in way to restrict this to read-only or append-only semantics.

In regulated industries (finance, healthcare, legal), certain records **must** be:
- **Read-only** — query-only, no writes via API at all (e.g., immutable event logs, regulatory reports)
- **Append-only / Immutable** — `POST` (create) is allowed, but `PUT`, `PATCH`, `DELETE` are not (e.g., audit trails, ledger entries, compliance records)

Currently, consumers declare a resource and then must add external permission guards to block mutation endpoints — but `defineResource` provides no structured way to do this, and the endpoints still exist and are reachable by authenticated users.

In regulated environments, ISO 27001, SOC 2, HIPAA, and similar standards require that audit trails be **technically immutable** — not just guarded by role checks that can be misconfigured.

#### Proposed Solution

Add two flags to `defineResource`:

```typescript
defineResource({
  resource: "audit-log",
  table: "audit_log",

  // Option A: No writes at all — GET list + GET one only
  readOnly: true,

  // Option B: CREATE + READ — no UPDATE or DELETE
  immutable: true,

  // ...
})
```

Behavior:
- `readOnly: true` → Framework registers only `GET /resource` and `GET /resource/:id`. All other methods return `405 Method Not Allowed`.
- `immutable: true` → Framework registers `GET /resource`, `GET /resource/:id`, and `POST /resource`. `PUT`, `PATCH`, `DELETE` return `405 Method Not Allowed`.
- Both flags should be reflected in the auto-generated OpenAPI/docs output.

**Acceptance Criteria:**
- [ ] `readOnly: true` blocks all mutation endpoints at the framework level (not just permission guards)
- [ ] `immutable: true` blocks update and delete endpoints at the framework level
- [ ] Blocked methods return `405 Method Not Allowed` with a clear body
- [ ] Auto-generated docs reflect the restricted method set

---

## 🟠 HIGH PRIORITY — ENTERPRISE & SECURITY FEATURES

---

### [SECURITY] FR-05 — `defineResource` Field List Must Guarantee SQL Column Projection

**Category:** Security — Data exposure  
**Affects:** Any consumer using `defineResource` with sensitive columns in the underlying table

#### Problem

When a consumer defines a resource with an explicit `fields` list, the contract should be: **only those fields are ever returned in API responses**. However, it is unclear whether Lumora's generated SQL uses the `fields` list for `SELECT` projection or whether it falls back to `SELECT *`.

If the underlying table has columns not declared in `fields` (e.g., `password_hash`, `secret_token`, `ssn`, `credit_card_last4`), and Lumora performs `SELECT *`, those columns are silently included in every API response.

This is a **data leakage vulnerability** with no visible indicator to the consumer.

#### Proposed Solution

1. **Guarantee** in the documentation: *"When `fields` is defined, Lumora generates `SELECT <field1>, <field2>, ...` — never `SELECT *`."*

2. Add an `excludeFields` option as a defense-in-depth mechanism:

```typescript
defineResource({
  resource: "users",
  table: "staff_users",
  excludeFields: ["password_hash", "reset_token", "mfa_secret"],
  fields: { ... }
})
```

`excludeFields` ensures those columns are never selected regardless of how `fields` is configured. This survives refactoring and future field additions.

3. Emit a **startup warning** if a table column exists in the database that is not declared in `fields` and not in `excludeFields`:
   > `[lumora] Warning: Column "password_hash" exists in table "staff_users" but is not declared in fields[]. If this is intentional, add it to excludeFields[] to silence this warning.`

**Acceptance Criteria:**
- [ ] Documentation guarantees `fields` list produces column-projected SQL (not `SELECT *`)
- [ ] `excludeFields` option is available on `defineResource`
- [ ] Startup emits a warning for undeclared database columns (opt-outable via `excludeFields`)

---

### [ENTERPRISE] FR-06 — Column-Level Role-Based Access Control in `defineResource`

**Category:** Enterprise — Authorization  
**Affects:** Any consumer with role-differentiated data access requirements

#### Problem

`defineResource` supports row-level access control via `permissions.scope` and `permissions.allow`. However, there is no mechanism for **column-level** access control — restricting which fields are visible to which roles.

This is a common requirement in multi-role systems where different personas have access to the same entity but different attributes:
- A `VIEWER` role can see a user's name and email but not their salary or SSN
- A `BILLING` role can see financial fields but not clinical or HR fields
- An `ADMIN` role can see all fields

Currently, the only workaround is to abandon `defineResource` for that resource and build a full procedural module — which eliminates all the benefits of Auto-CRUD.

#### Proposed Solution

Add a `visibleTo` property on field definitions:

```typescript
defineResource({
  resource: "employees",
  table: "employees",
  fields: {
    name:         { type: "string" },                            // visible to all
    email:        { type: "string" },                            // visible to all
    salary:       { type: "number", visibleTo: ["ADMIN", "HR"] }, // restricted
    ssn_last4:    { type: "string", visibleTo: ["ADMIN"] },      // highly restricted
    department:   { type: "string" },                            // visible to all
  }
})
```

Behavior:
- Fields without `visibleTo` are visible to all authenticated users with access to the resource.
- Fields with `visibleTo` are **stripped from the response** if the caller's role is not in the list.
- The role is read from the JWT claims using the same auth context as `permissions.allow`.

**Acceptance Criteria:**
- [ ] `visibleTo: string[]` is a valid field option in `defineResource`
- [ ] Fields with `visibleTo` are omitted from responses for callers with non-matching roles
- [ ] Works on both list and single-record endpoints
- [ ] `visibleTo` fields are omitted from OpenAPI docs for non-authorized roles (or marked as role-restricted)

---

### [DATA SAFETY] FR-07 — Cron Scheduler Needs Error Handling, Retry, and Execution Logging

**Category:** Enterprise — Reliability and data integrity  
**Affects:** Any consumer using the `schedule` config array for business-critical tasks

#### Problem

The `schedule` array in `defineLumoraConfig` registers cron tasks. The current implementation has critical production gaps:

1. **Silent failure**: If a scheduled task throws (database connection loss, constraint violation, timeout), the error is unhandled. The task simply does not complete, and no indication of failure is surfaced anywhere.

2. **No retry**: There is no mechanism to retry a failed task, even for transient failures (brief DB unavailability).

3. **No execution history**: There is no way to query "did this task run at 00:00?", "did it succeed?", "how long did it take?" without building this infrastructure separately.

4. **Data loss on silent failure**: If a scheduled task is responsible for posting records (charges, notifications, reconciliation), silent failure means those records are never posted and there is no alert.

This is a data loss scenario for any billing, ledger, or record-keeping task.

#### Proposed Solution

**Minimum required — `onError` handler:**

```typescript
schedule: [
  {
    name: "nightly-reconciliation",
    cron: "0 0 * * *",
    handler: async ({ database }) => { /* ... */ },
    onError: async (error, { name, database }) => {
      console.error(`[cron:${name}] FAILED:`, error.message);
      // consumer can send alert, write to a table, etc.
    },
    retry: { attempts: 3, delayMs: 5_000 }, // optional
  }
]
```

**Optional but recommended — built-in execution log table:**

```typescript
schedule: [
  {
    name: "nightly-reconciliation",
    cron: "0 0 * * *",
    handler: async ({ database }) => { /* ... */ },
    log: true, // writes to lumora_cron_log table
  }
]
```

The `lumora_cron_log` table (created automatically if any task has `log: true`):
```sql
CREATE TABLE lumora_cron_log (
  id          BIGSERIAL PRIMARY KEY,
  task_name   TEXT NOT NULL,
  status      TEXT NOT NULL,  -- 'success' | 'error'
  error       TEXT,
  duration_ms INTEGER,
  ran_at      TIMESTAMPTZ DEFAULT NOW()
);
```

**Acceptance Criteria:**
- [ ] `onError` callback is supported per scheduled task
- [ ] Errors in task handlers are caught internally and routed to `onError` (never crash the process)
- [ ] Optional `retry` config with `attempts` and `delayMs`
- [ ] Optional `log: true` per task writes execution records to a managed table

---

### [ENTERPRISE] FR-08 — Scoped Database Handle for Multi-Tenant Procedural Modules

**Category:** Enterprise — Multi-tenancy, data isolation  
**Affects:** Any consumer building multi-tenant applications with procedural modules

#### Problem

`defineResource` enforces multi-tenant data isolation automatically via `permissions.scope: { field: 'tenant_id' }`. This appends `WHERE tenant_id = <claims.tenant_id>` to every generated query.

**Procedural modules have no equivalent mechanism.** Every route handler must manually extract the tenant identifier from JWT claims and append it to every query:

```typescript
// Every single query in every procedural module
const user = c.get("user");
const rows = await db.sql`
  SELECT * FROM orders
  WHERE tenant_id = ${user.tenantId}   -- ← must not forget this
  AND id = ${orderId}
`;
```

If any developer forgets this clause on any endpoint — even a low-risk "read" endpoint — a **cross-tenant data leak** occurs. This is one of the most dangerous classes of multi-tenant bugs and is entirely preventable at the framework level.

#### Proposed Solution

Provide a `ctx.db.scoped(tenantId)` factory that returns a tenant-aware DB handle:

```typescript
// In a procedural module:
const tenantDb = ctx.db.scoped(user.tenantId);

// All queries through this handle automatically append AND tenant_id = $tenantId
const rows = await tenantDb.sql`SELECT * FROM orders WHERE id = ${orderId}`;
// Effective SQL: SELECT * FROM orders WHERE id = $1 AND tenant_id = $2
```

The scope field name is configurable:

```typescript
// In defineLumoraConfig:
multiTenancy: {
  field: "tenant_id",  // column name used by ctx.db.scoped()
}
```

Alternatively, a middleware helper:

```typescript
// Returns a middleware that sets a scoped db handle on the context
router.use("*", requireTenantScope(ctx, { claimsKey: "tenantId", field: "tenant_id" }));

// In handler:
const db = c.get("tenantDb"); // scoped handle, never leaks across tenants
```

**Acceptance Criteria:**
- [ ] `ctx.db.scoped(tenantId)` returns a DB handle that appends a tenant condition to all queries
- [ ] The tenant scope field name is configurable
- [ ] A `requireTenantScope` middleware helper is available for procedural modules
- [ ] Attempting to execute a query through the scoped handle with an undefined/null tenantId throws immediately

---

### [INTEGRATION] FR-09 — Standardized Response Envelope for Procedural Modules

**Category:** Enterprise — API consistency and integration  
**Affects:** Any consumer mixing Auto-CRUD resources with procedural modules

#### Problem

Auto-CRUD resources return a consistent envelope:
- List: `{ "data": [...] }`
- Single: `{ "data": { ... } }`
- List with pagination: `{ "data": [...], "meta": { "total": 100 } }`

Procedural modules have no equivalent helper. Route handlers return raw `c.json(...)` with application-specific shapes. This creates inconsistency within the same API, breaking client SDK generation, integration testing, and API documentation.

#### Proposed Solution

Export a `c.lumoraJson()` helper available on the Hono context in procedural modules:

```typescript
// List response
return c.lumoraJson(rows);
// → { "data": [...] }

// List with meta
return c.lumoraJson(rows, { total: 500, page: 2, pages: 20 });
// → { "data": [...], "meta": { "total": 500, "page": 2, "pages": 20 } }

// Single record
return c.lumoraJson(row);
// → { "data": { ... } }

// Error (normalized)
return c.lumoraError("Not found", 404);
// → { "error": "Not found" } with status 404
```

This is an **opt-in** helper — existing `c.json()` calls continue to work. This allows incremental adoption.

Additionally, consider a `strictEnvelope: true` option in `defineLumoraConfig` that validates all route responses conform to the envelope at dev-time.

**Acceptance Criteria:**
- [ ] `c.lumoraJson(data, meta?)` is available on Hono context in mounted modules
- [ ] `c.lumoraError(message, status)` is available
- [ ] Both helpers are typed (TypeScript generic-aware)
- [ ] Auto-CRUD envelope and `lumoraJson` envelope are identical in structure

---

### [DATA SAFETY] FR-10 — Migration Engine Needs Checksum Verification and Forward-Only Guard

**Category:** Enterprise — Data safety on rollback / deployment  
**Affects:** Any consumer using `migrations.mode: "auto"` in packaged / on-premise deployments

#### Problem

With `migrations.mode: "auto"`, Lumora applies all pending migrations on startup. There are three data-safety gaps:

1. **No checksum verification**: If a migration file that was already applied is modified (accidentally or deliberately), the database and codebase diverge silently. The migration state table only tracks filenames and applied timestamps — not content integrity.

2. **No forward-only guard**: If an older version of the application is deployed while the database has migrations from a newer version (e.g., a version rollback), the server starts successfully and operates against a schema it does not understand. This is a data corruption scenario.

3. **No destructive migration gate**: Migrations containing `DROP COLUMN`, `DROP TABLE`, `TRUNCATE`, or `ALTER COLUMN ... TYPE` (with data coercion) can run silently and irreversibly. There is no mechanism to require explicit confirmation for destructive migrations.

#### Proposed Solution

**Checksum column on the migration state table:**

```sql
-- Add to existing migrations tracking table
ALTER TABLE lumora_migrations ADD COLUMN checksum TEXT;
```

On startup, Lumora recalculates the SHA-256 of each applied migration file and compares it to the stored checksum. Mismatch → startup aborts with:
> `[lumora] FATAL: Migration "20240101_001_init.sql" has been modified after it was applied. Checksum mismatch. Aborting.`

**Forward-only guard:**

```typescript
migrations: {
  dir: "./migrations",
  mode: "auto",
  allowDowngrade: false,  // default — refuse to start if DB is ahead of codebase
}
```

If the DB has applied migrations that don't exist in the migration directory, startup fails:
> `[lumora] FATAL: Database has 3 migrations not present in the codebase. This may indicate a version rollback. Set migrations.allowDowngrade: true to bypass this check.`

**Destructive migration gate (opt-in):**

```typescript
migrations: {
  blockDestructive: true, // parse SQL; refuse migrations containing DROP/TRUNCATE/ALTER TYPE
}
```

**Acceptance Criteria:**
- [ ] Migration state table stores a SHA-256 checksum of each applied file
- [ ] Startup verifies checksums of all previously applied migrations; mismatch = abort
- [ ] Startup detects DB-ahead-of-codebase state and fails with a clear message by default
- [ ] `allowDowngrade: true` bypasses the forward-only guard explicitly
- [ ] Optional `blockDestructive: true` config that parses and rejects destructive SQL

---

## 🟡 MEDIUM PRIORITY — DEVELOPER EXPERIENCE

---

### [DX] FR-11 — Global Protected Paths Declaration via `mountModule` or Config

**Category:** Developer experience — Reducing auth boilerplate  
**Affects:** All consumers using procedural modules alongside Auto-CRUD resources

#### Problem

`defineResource` with `auth: { mode: "protected" }` automatically applies JWT verification. Procedural modules have no equivalent — every module must implement its own auth middleware:

```typescript
// Repeated verbatim in every module: auth, billing, opd, labsys, medstore...
router.use("*", async (c, next) => {
  const auth = await resolveAuthFromContext(c as any, ctx.auth);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", auth.claims ?? {});
  await next();
});
```

This boilerplate is copy-pasted into every module. Any change to the auth guard (e.g., adding an audit step, changing the claims key) must be applied in every module individually.

#### Proposed Solution

**Option A — `mountModule` with protection flag:**

```typescript
instance.mountModule("/orders", createOrdersRouter(ctx), { protected: true });
instance.mountModule("/auth", createAuthRouter(ctx), { protected: false }); // public routes
```

**Option B — `protectedPaths` in `defineLumoraConfig`:**

```typescript
defineLumoraConfig({
  // ...
  protectedPaths: ["/orders", "/billing", "/admin"],
  publicPaths: ["/auth", "/health"],
})
```

When a path is declared as protected, Lumora applies its JWT middleware to all requests under that prefix — removing the need for per-module middleware.

**Option C — A `createAuthMiddleware(ctx)` factory** that returns a pre-configured, standardized middleware with the correct claims key and error format:

```typescript
const authMiddleware = createAuthMiddleware(ctx); // single import, no manual implementation
router.use("*", authMiddleware);
```

**Acceptance Criteria:**
- [ ] At least one of the three options above is implemented
- [ ] Protected modules no longer require manual `resolveAuthFromContext` boilerplate
- [ ] Public routes (login, health checks) remain unaffected

---

### [RELIABILITY] FR-12 — Graceful Shutdown API on `LumoraInstance`

**Category:** Enterprise — Reliability  
**Affects:** All consumers, especially those with scheduled tasks, WebSocket connections, or database transactions

#### Problem

`initLumora()` returns an instance, but provides no shutdown API. The consumer is responsible for calling `Bun.serve()` (or the equivalent) themselves. When the process receives `SIGTERM` (from a process manager, container runtime, or `snap stop`), there is no way to:

1. Wait for in-flight HTTP requests to complete before shutting down (some may be mid-transaction)
2. Stop the cron scheduler cleanly (a running task may be killed mid-execution, leaving data in a partial state)
3. Close the database connection pool gracefully (abrupt closure causes `connection terminated` errors)

This leads to transaction corruption, data inconsistency, and noisy error logs on every deployment restart.

#### Proposed Solution

```typescript
// Register cleanup handlers
instance.onShutdown(async () => {
  console.log("Closing external connections...");
  await externalService.disconnect();
});

// Call on SIGTERM/SIGINT
process.on("SIGTERM", async () => {
  await instance.shutdown({
    drainTimeoutMs: 10_000, // wait up to 10s for in-flight requests
  });
  process.exit(0);
});
```

`instance.shutdown()` should:
1. Stop accepting new connections
2. Stop the cron scheduler (no new jobs start; running jobs are awaited up to `drainTimeoutMs`)
3. Wait for in-flight HTTP requests to complete (up to `drainTimeoutMs`)
4. Run all registered `onShutdown` handlers
5. Close the DB connection pool

**Acceptance Criteria:**
- [ ] `instance.onShutdown(fn)` registers an async cleanup handler
- [ ] `instance.shutdown(options?)` performs an ordered, graceful shutdown
- [ ] Shutdown stops the scheduler, drains requests, and closes the DB pool
- [ ] `shutdown()` resolves (or times out gracefully) even if a handler throws

---

### [RELIABILITY] FR-13 — `logAudit` Failure Must Not Propagate to the HTTP Response

**Category:** Reliability — False error responses  
**Affects:** All consumers using `logAudit` in request handlers

#### Problem

`logAudit(db, { ... })` is an `async` function. When called with `await`, any exception it throws (database briefly unreachable, constraint violation, etc.) propagates to the route handler and returns a `500 Internal Server Error` to the client.

This is semantically wrong: the **primary business operation succeeded** (the record was saved, the payment was posted), but the client receives an error response. The client will likely retry the operation, potentially creating duplicate records or double-charges.

`logAudit` is a side effect of a completed operation — its failure should never be observable by the API caller.

#### Proposed Solution

Make `logAudit` non-blocking by default:

```typescript
// Default: fire-and-forget, errors are logged internally
logAudit(db, { userId, action, entityType, entityId });

// Opt-in: await and propagate errors (for testing or strict compliance)
await logAudit(db, { userId, action, entityType, entityId }, { strict: true });
```

Internal default behavior:
```typescript
// Inside logAudit (default)
setImmediate(() => {
  db.sql`INSERT INTO audit_log ...`.catch((err) => {
    console.error("[lumora:audit] Failed to write audit log:", err.message);
  });
});
```

**Acceptance Criteria:**
- [ ] `logAudit` in default mode never throws to the caller
- [ ] Internal errors in `logAudit` are logged to `console.error` with a `[lumora:audit]` prefix
- [ ] A `{ strict: true }` option enables the current (propagating) behavior for consumers who need it
- [ ] Docs clearly state the default is non-blocking

---

### [DX] FR-14 — Export `LumoraSqlTransaction` Type for Type-Safe Transaction Callbacks

**Category:** Developer experience — TypeScript correctness  
**Affects:** All consumers using `db.sql.begin()` in procedural modules or cron handlers

#### Problem

Inside `db.sql.begin(async (sql) => { ... })`, the `sql` argument has no exported TypeScript type. Consumers are forced to annotate it as `any`:

```typescript
await db.sql.begin(async (sql: any) => {  // ← forced cast, loses all type safety
  await sql`INSERT INTO ...`;
  await sql`UPDATE ...`;
});
```

Similarly, inside cron task handlers in `defineLumoraConfig`, the `database` parameter in the handler is typed, but the transaction object returned by `database.sql.begin()` is not.

This is a straightforward TypeScript export omission.

#### Proposed Solution

Export the transaction SQL type from the framework's public API:

```typescript
import type { LumoraSqlTransaction, LumoraDatabase } from "@astrake/lumora-server";

// Now usable in type annotations:
await db.sql.begin(async (sql: LumoraSqlTransaction) => {
  const result = await sql`SELECT ...`;
  // result is typed based on the query
});

// Also useful for extracting a transaction into a helper function:
async function createOrder(sql: LumoraSqlTransaction, data: OrderData) {
  return sql`INSERT INTO orders ...`;
}
```

**Acceptance Criteria:**
- [ ] `LumoraSqlTransaction` (or equivalent) is exported from `@astrake/lumora-server`
- [ ] `LumoraDatabase` is exported and matches the type of `ctx.db` and `instance.database`
- [ ] All type parameters are documented in the API reference
- [ ] `db.sql.begin()` callback parameter is typed using this exported type (no `any` necessary)

---

## Summary

| ID | Tier | Category | Title |
|---|---|---|---|
| FR-01 | 🔴 Critical | Security | `rateLimit()` in-memory store unsafe for production |
| FR-02 | 🔴 Critical | Security | `resolveAuthFromContext` expiry enforcement undocumented |
| FR-03 | 🔴 Critical | Security | CORS config incomplete; consumers forced into insecure workaround |
| FR-04 | 🔴 Critical | Data Integrity | No `readOnly` or `immutable` mode on `defineResource` |
| FR-05 | 🟠 High | Security | `fields` list must guarantee SQL column projection |
| FR-06 | 🟠 High | Enterprise | Column-level RBAC (`visibleTo`) in `defineResource` |
| FR-07 | 🟠 High | Data Safety | Cron scheduler silent failure — needs `onError`, retry, and logging |
| FR-08 | 🟠 High | Enterprise | Scoped DB handle for multi-tenant procedural modules |
| FR-09 | 🟠 High | Integration | Standardized response envelope helper for procedural modules |
| FR-10 | 🟠 High | Data Safety | Migration checksum verification and forward-only startup guard |
| FR-11 | 🟡 Medium | DX | Protected path declaration to eliminate per-module auth boilerplate |
| FR-12 | 🟡 Medium | Reliability | Graceful shutdown API (`instance.shutdown()`, `instance.onShutdown()`) |
| FR-13 | 🟡 Medium | Reliability | `logAudit` must not propagate exceptions to HTTP responses |
| FR-14 | 🟡 Medium | DX | Export `LumoraSqlTransaction` type for type-safe transaction callbacks |

---

*This document represents feature requests and bug reports from a production user of `@astrake/lumora-server`. All issues are grounded in observed framework behavior. Priority ordering reflects real-world risk and user impact.*
