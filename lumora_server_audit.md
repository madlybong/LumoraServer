# @astrake/lumora-server Audit Report

**Scope**: `ERPSystem/server` — all 28 route definitions, `lumora.config.ts`, `src/*.ts` custom services, and the installed `@astrake/lumora-server@0.1.7` library code inside `node_modules`.

**Date**: 2026-04-29

---

## 1. Local `node_modules` Patches (Will Be Lost on `npm install`)

> [!CAUTION]
> Three files inside `node_modules/@astrake/lumora-server/src/` were directly edited during Phase 8. These changes are **not version-controlled** and will be **silently destroyed** by any `bun install`, `npm ci`, or lock-file resolution.

### 1.1 `db.ts` — Search + COUNT

| What changed | Why |
|---|---|
| `buildWhereClause()` now accepts an optional `searchTerm` parameter and builds `LIKE '%term%'` clauses on `searchable` fields | The published `0.1.7` treats `?search=` as an unrecognized filter key and silently ignores it |
| Reserved params (`page`, `pageSize`, `sort`, `search`) are now skipped in the filter loop | Without this, `page=2` was being treated as a `WHERE page = '2'` filter condition |
| `list()` now runs a parallel `COUNT(*)` query and returns `{ items, total, page, pageSize }` | Published version never computed `total` — pagination was cosmetic |

### 1.2 `runtime.ts` — Response Shape + PATCH Route + Param Alias

| What changed | Why |
|---|---|
| GET list response changed from `{ ok, data: { items, page, pageSize } }` to `{ ok, data: T[], total, page, pageSize }` | Client expected flat `data` array, got nested `data.items` |
| `?limit=` accepted as alias for `?pageSize=` | Client-side convention used `limit` uniformly |
| `maxPageSize` raised from `100` to `1000` | Reports export needed bulk fetch (`limit=10000` scaled down to 1000) |
| New `app.patch()` route handler added for every resource | No PATCH existed in the published library — only GET/POST/PUT/DELETE |

### 1.3 Impact Assessment

```
Risk: CRITICAL — next `bun install` or CI pipeline will revert ALL patches
Fix:  Must upstream into lumora-server 0.2.0 before any package update
```

---

## 2. Constitution / Framework Rule Violations

### 2.1 Bypassed Auth in `src/shopify.ts`

```typescript
// shopify.ts line 6 — mounts route OUTSIDE the resource system
lumora.app.post("/api/v1/webhooks/shopify", async (c) => { ... })
```

- This route is **not** protected by `authorize()` or `checkPermission()`.
- The `HMAC verification` comment on line 7 is a stub — no actual verification occurs.
- Accesses database via `(lumora.app as any).__database` — a non-existent property (the actual path is `lumora.database`).

> [!WARNING]
> The `__database` cast means the Shopify webhook handler **silently fails** — `db` is always `undefined`, so orders from Shopify are never persisted. This is a dead code path.

### 2.2 Manual SQL in `src/seed.ts`

```typescript
// seed.ts line 12 — opens a SECOND database connection
const db = new Database(dbPath);
```

- Uses `bun:sqlite`'s `Database` directly, bypassing the `LumoraDatabase` instance.
- Creates a dual-connection race condition — `initLumora()` opens one connection via `bun:sql`, then `seed.ts` opens another via `bun:sqlite`.
- Should use `lumora.database.sql` for all queries.

### 2.3 Scheduler Accesses Internal via Type Hack

```typescript
// scheduler.ts line 14
const db = (lumora.app as any).__database;
```

Same bug as `shopify.ts` — `__database` does not exist. The correct access is `lumora.database.sql`. The MIS scheduler's daily email **never queries real data** because `db` is always `undefined`.

### 2.4 Missing `payment_status` Field on Invoices Route

The **client** calls `api.patch('/invoices/:id', { payment_status: 'paid' })` but the `invoices.ts` route definition has:
- `status` field (unpaid/paid/void/refunded)
- **No** `payment_status` field

The PATCH goes through the `database.update()` path which does raw SQL — so the column gets written to SQLite dynamically. But it:
1. Is never validated by `validatePayload()`
2. Is never included in `normalizeRecord()` output
3. Will silently persist in the DB but may not be returned in GET responses

### 2.5 Dead Import in `users.ts`

```typescript
// users.ts line 2
import { hash } from "bun"; // We can use Bun's built-in password hashing
```

`hash` is imported from `"bun"` but **never used** — the actual hashing uses `Bun.password.hash()` (the global). This import may cause a build warning.

### 2.6 `audit-logs.ts` Route → Table Collision

```typescript
// audit-logs.ts
resource: "audit-logs",
table: "_audit_logs",
```

The route points at the **system-managed** `_audit_logs` table that `LumoraDatabase.ensureAuditTable()` creates. This means:
- `ensureResource()` runs a `CREATE TABLE IF NOT EXISTS _audit_logs (...)` with the route's field schema, which **differs** from the internal audit schema (different column names).
- Since `CREATE TABLE IF NOT EXISTS` silently succeeds when the table exists, whichever runs first wins — creating a schema mismatch risk.

---

## 3. Security Gaps

### 3.1 No JWT `exp` Validation Server-Side

The library's `auth.ts` → `verifyJwt()` checks:
- ✅ Signature (HMAC-SHA256)
- ✅ Issuer (`iss`)
- ✅ Audience (`aud`)
- ❌ **Expiry (`exp`)** — never checked

We added `exp` to the login handler in Phase 10, but the **server never validates it**. An expired JWT will still pass signature verification and be accepted for all API requests.

### 3.2 No Shopify HMAC Verification

The webhook endpoint comment says "verify the HMAC signature" but the implementation does not. In production, anyone can POST to `/api/v1/webhooks/shopify` with arbitrary payloads.

### 3.3 `password_hash` Exposed in GET Responses

The `users` resource has `password_hash` as a field. The library has **no concept of `hidden` fields** — every field defined in the schema is returned in GET responses. This means:
- `GET /api/v1/users` returns every user's bcrypt hash
- There is no `afterGet` hook to strip sensitive fields

### 3.4 No CORS Configuration

The Hono app has no CORS middleware configured. In production with a separate frontend domain, all API requests will be blocked by browser CORS policy.

---

## 4. Architectural Gaps in the Library

### 4.1 Empty `afterCreate` Hooks (Side-Effect Placeholders)

Two routes have `afterCreate` hooks that are **empty function stubs**:

| Route | What the comment says should happen |
|---|---|
| `invoices.ts` L33-38 | "Deduct from stock table, calculate margin, write to margin-records" |
| `purchase-receipts.ts` L25-28 | "Update raw-material-stock directly" |

These represent **cross-resource transactional boundaries** that the framework doesn't support. The `afterCreate` hook only receives the record — it has no access to `lumora.database` to write to other tables.

### 4.2 No Cross-Resource Transaction Support

The library provides:
- `db:transaction:before/after/rollback` events
- `resource:create:after` events

But no way to:
- Access the database from within a hook
- Execute multi-table writes atomically
- Chain resource operations (e.g., "create invoice → deduct stock → write margin record" in a single transaction)

### 4.3 No Field-Level `hidden` or `readOnly` Flags

The `ResourceField` type supports:
```typescript
type, required, description, filterable, sortable, searchable, default
```

Missing:
- `hidden: true` — to exclude fields from GET responses (for `password_hash`, internal IDs)
- `readOnly: true` — to prevent client mutation (for `created_by`, `approved_by`, timestamps)
- `writeOnly: true` — to accept a field on POST/PUT but never return it

### 4.4 No `PATCH` Permission Type

The `ResourceMethod` union is:
```typescript
"GET_LIST" | "GET_ONE" | "POST" | "PUT" | "DELETE"
```

The local patch added a PATCH route, but it reuses the `PUT` permission check. The type system has no `"PATCH"` variant, so consumers can't define separate permission rules for partial updates.

### 4.5 No Unique Constraints / Indexes

`ensureResource()` creates tables with `id VARCHAR(191) PRIMARY KEY` but:
- No `UNIQUE` constraint on business keys (e.g., `invoice_number`, `sku_code`, `email`)
- No `CREATE INDEX` for `filterable` or `searchable` fields
- At scale, every `WHERE` clause is a full table scan

---

## 5. Unused Library Features

### 5.1 Realtime (SSE / WebSocket) — Never Consumed

Every resource gets `/${resource}/events` (SSE) and `/${resource}/ws` (WebSocket) endpoints auto-generated. The ERP client has **zero** SSE or WebSocket consumers — all data flows through polling via `useApi.get()`.

### 5.2 AI Service — Instantiated, Never Called

`lumora.config.ts` configures `ai: { source: "db", table: "app_settings" }`, so `createAIService()` is called during init. But:
- No server route calls `lumora.ai.complete()`
- The client's ContentRecordsView "Generate with AI" button is a client-side `setTimeout()` stub
- The AI service is fully functional — just needs a custom route to expose it

### 5.3 Email `test()` — No Admin Endpoint

`lumora.email.test()` exists and verifies SMTP connectivity, but there's no API route for the admin to trigger a test email from the Settings UI.

### 5.4 `meta` / `admin` Schema Options — Unused

The `ResourceSchema` supports:
```typescript
meta: { title, description, group, admin: { hidden, icon } }
```

None of the 28 routes use `meta`. The OpenAPI docs would benefit from `title` and `description` for each resource, and a future admin dashboard could use `group` and `icon`.

---

## 6. Route-Level Issues

### 6.1 Boilerplate RBAC Duplication

Every route manually extracts roles and checks membership:
```typescript
const roles = (ctx.auth?.claims?.roles as string[]) || [];
if (!roles.includes("vendor-maker") && !roles.includes("super-admin")) {
  throw new Error("Forbidden");
}
```

This 4-line pattern is repeated **~50 times** across 28 files. The library should provide a declarative `roles` shorthand:
```typescript
permissions: {
  POST: { roles: ["vendor-maker"] },  // super-admin is implicit
}
```

### 6.2 Phantom Role `admin`

Two routes reference a role called `"admin"`:
- `stores.ts` → `POST` permission
- `price-codes.ts` → `POST` and `PUT` permission

But the seed script defines **14 roles** and `"admin"` is not one of them. These permissions will always fail unless the user is `super-admin`.

### 6.3 Inconsistent `sortable` Usage

Only `audit-logs.ts` uses the `query.sortable` array. All other resources rely on the implicit default (`ORDER BY updated_at DESC`). Key business lists like invoices, purchase-orders, and jobs should support date-based sorting.

### 6.4 Client Sends `invoice_type`, Server Defines `channel`

The InvoicesView form uses `invoice_type: 'retail' | 'b2b'` as the field name, but the server schema defines the field as `channel`. Since `validatePayload()` only accepts defined field names, `invoice_type` is **silently dropped** during create. The invoice's `channel` field is never populated.

### 6.5 Workshop Jobs: Silent Status Rewrite

```typescript
// workshop-jobs.ts line 40-41
if (input.status === "completed") {
   input.status = "qc_pending"; // Force qc_pending state
}
```

The client's "Complete Job" workflow sends `status: 'completed'`, but the server **silently rewrites it to `qc_pending`**. The client then optimistically updates the UI to show "completed" but the database actually has "qc_pending". There's no error or feedback — just a silent state mismatch.

---

## 7. Proposed `0.2.0` Upgrade Roadmap

Features that should be upstreamed into `@astrake/lumora-server` to eliminate the local patches and fix the architectural gaps:

| # | Feature | Impact | Effort |
|---|---|---|---|
| 1 | **PATCH route** — first-class partial update method | Eliminates local runtime.ts patch | S |
| 2 | **COUNT + total** in list response | Eliminates local db.ts patch | S |
| 3 | **`?search=` LIKE query** on searchable fields | Eliminates local db.ts patch | S |
| 4 | **`?limit=` alias** for `?pageSize=` | Eliminates local runtime.ts patch | XS |
| 5 | **JWT `exp` validation** in `verifyJwt()` | Closes security gap §3.1 | S |
| 6 | **Field `hidden` flag** — exclude from GET responses | Fixes password_hash exposure §3.3 | M |
| 7 | **Field `readOnly` flag** — reject client mutation | Prevents approved_by / created_by tampering | M |
| 8 | **Declarative `roles` shorthand** in permissions | Eliminates ~200 lines of boilerplate §6.1 | M |
| 9 | **`PATCH` permission type** in ResourceMethod union | Separates PATCH from PUT authorization | S |
| 10 | **Hook database access** — pass `db` into hook context | Enables cross-resource transactions §4.2 | M |
| 11 | **CORS middleware config** — `cors: { origin, methods }` in config | Production deployment §3.4 | S |
| 12 | **Unique constraints / indexes** — `unique: true`, `indexed: true` on fields | Data integrity + performance §4.5 | L |

---

## Summary Matrix

| Category | Count | Severity |
|---|---|---|
| Local patches at risk | 3 files, ~90 lines | 🔴 CRITICAL |
| Constitution violations | 6 issues | 🟠 HIGH |
| Security gaps | 4 issues | 🔴 CRITICAL |
| Architectural gaps | 5 issues | 🟡 MEDIUM |
| Unused features | 4 items | 🟢 LOW |
| Route-level issues | 5 issues | 🟠 HIGH |
| Proposed 0.2.0 features | 12 items | — |
