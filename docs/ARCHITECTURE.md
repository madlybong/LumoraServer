# Architecture Guide

## System shape

Lumora now has one main runtime package and one reference app. The runtime flow is:

1. load and resolve `lumora.config.ts`
2. discover resource files from `routes.dir`
3. initialize DB connectivity
4. create generated REST, SSE, and WebSocket routes for each resource
5. expose the runtime instance to the parent app

The parent app calls `initLumora(...)` and passes the returned `fetch` and `websocket` handlers into `Bun.serve(...)`.

## Agentic Architecture Recommendation

For a clean, production-ready, and AI-friendly setup, Lumora recommends explicitly separating **Declarative Resources** from **Imperative Routes**. See the [Recommended Project Template](PROJECT_TEMPLATE.md) for details on setting up `src/resources` and `src/routes`.

## Core modules

All active framework code lives in `packages/core/src`.

Key modules:

- `types.ts`
  Public config, resource, event, auth, docs, and runtime types.
- `config.ts`
  `defineLumoraConfig`, config loading, resolution, and validation.
- `resource.ts`
  `defineResource` and resource path normalization.
- `runtime.ts`
  Route discovery, CRUD generation, auth checks, realtime routes, and docs routes.
- `db.ts`
  Slim DB-backed CRUD engine and transaction event emission.
- `realtime.ts`
  In-memory publish/subscribe hub for SSE and WebSocket fan-out.
- `auth.ts`
  Static token and JWT resolution.
- `init-wizard.ts`
  Interactive scaffolding for new or existing Bun apps.

## Public API

The intended public surface is small:

- `defineLumoraConfig(...)`
- `defineResource(...)`
- `initLumora(configOrPath)`

The returned runtime instance exposes:

- `app`
- `fetch`
- `websocket`
- `config`
- `database`
- `events`
- `realtime`
- `docs`
- `query`
- `resources`
- `apiPrefix`
- `mountModule(path, router, options?)`
- `shutdown()` / `stop()`
- `onShutdown(callback)`
- `close()`

## Resource model

Each `routes/*.ts` file defines a resource schema, not imperative handlers by default.

A resource can define:

- `resource`
- `table`
- `fields`
- `auth`
- `query`
- `permissions`
- `audit`
- `hooks`
- `meta`

The runtime uses that schema to generate:

- `GET /{base}/{version}/{resource}`
- `GET /{base}/{version}/{resource}/:id`
- `POST /{base}/{version}/{resource}`
- `PUT /{base}/{version}/{resource}/:id`
- `PATCH /{base}/{version}/{resource}/:id`
- `DELETE /{base}/{version}/{resource}/:id`
- `GET /{base}/{version}/{resource}/events` *(when `realtime.enabled: true`)*
- `GET /{base}/{version}/{resource}/ws` *(when `realtime.enabled: true`)*

## Auth model

Auth is intentionally environment-sensitive:

- development can use `disabled`
- production must not use `disabled`
- supported production strategies are `static`, `jwt`, and `custom`

Resource auth can override behavior with:

- `inherit`
- `public`
- `protected`

**Custom Auth, Claim Mapping & Dual-Token Rotation (`RFC-01` / `LP-04`)**:
- `auth.mode: "custom"` accepts a `verify(c) => Promise<LumoraAuthResult | null>` callback, allowing host applications with custom session/TOTP/OAuth middleware to run in `production` mode while participating in Lumora's `afterVerify`, `protectedPaths`, `publicPaths`, and `permissions` pipeline.
- `auth.mode: "jwt"` supports `claimMapping` (`subject`, `roles`, `tenantId`, and multi-axis `scopes`), `refreshSecret`, and exported helpers `signLumoraJwt()` and `rotateLumoraTokens()`.

## DB model

The current runtime assumes DB-backed resources. The implementation is intentionally slim:

- SQLite, MySQL, and PostgreSQL (`bun:sql`) config shapes are first-class.
- PostgreSQL adapter explicitly supports connection pooling (`pool: { min, max }`), `schema` definitions (mapped to `search_path`), and TLS/SSL configurations.
- **Enterprise SQLite Pragmas (`RFC-02`)**: On connection initialization for non-memory SQLite databases, Lumora automatically applies `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, `PRAGMA synchronous = NORMAL`, `PRAGMA foreign_keys = ON`, and `PRAGMA cache_size = -64000` (all configurable via `database.pragmas`). On shutdown, Lumora runs `PRAGMA wal_checkpoint(TRUNCATE)`.
- **Atomic SQLite Auto-Backup & Restore (`RFC-03` / `LP-02`)**: When `database.autoBackup: true` is enabled, Lumora executes an atomic `VACUUM INTO` snapshot (falling back to file + `-wal`/`-shm` copy), prunes old backups via `maxRetainedBackups`, and automatically restores the pre-migration snapshot if a migration fails.

This is not an ORM layer. The resource DSL is smaller and more constrained by design.

## Realtime model

Lumora keeps one resource event model across:

- server-side event emitter
- SSE broadcasts
- WebSocket broadcasts
- generated CRUD side effects

That lets the parent app subscribe once and react consistently across transports.

**Opt-in Mounting, Tenant Isolation, Heartbeats & Replay (`RFC-06` / `LP-05`)**:
- By default, `/events` (SSE) and `/ws` (WebSockets) routes are not mounted unless `realtime: { enabled: true }` is set in `lumora.config.ts`.
- Supports tenant-partitioned channels via `lumora.realtime.publishToTenant(tenantId, event, payload)` and `createTenantSseResponse(tenantId, channel, c?, options?)`.
- Resource SSE and WebSocket streams automatically filter events by the subscriber's `tenantId` and `permissions.scope.field`.
- Configurable SSE keep-alive heartbeat comments (`: ping\n\n` via `heartbeatIntervalMs`, default `25000ms`) and ring-buffer event replay via `Last-Event-ID` (`maxReplayBuffer`, default `100`).

## Docs model

In development (or when `docs.enabled: true`), Lumora exposes:

- an OpenAPI 3.1.0 JSON document (`/__lumora/openapi.json`)
- a simple docs UI route (`/__lumora/docs`)

**Sub-Router OpenAPI Introspection (`RFC-07`)**:
`lumora.mountModule(prefix, router, options)` automatically introspects both `@hono/zod-openapi` (`OpenAPIHono`) sub-routers and standard `Hono` sub-routers (`router.routes`), merging their paths, parameters, security schemes, and tags into `/__lumora/openapi.json`.

## Rate Limiting & Security Headers

Lumora provides a built-in API rate limiting subsystem (`RFC-04`):

- Controlled via `rateLimit` config block (`enabled`, `windowMs`, `max`, `store`).
- Built-in stores include `"memory"` (with automatic expired-key eviction) and `"database"` (PostgreSQL `lumora_rate_limits` table).
- Emits standard `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` headers.
- Automatically inherited by sub-routers mounted via `mountModule()` when `config.rateLimit.enabled` is true (unless explicitly opted out with `rateLimit: false`).
- Global middleware emits baseline security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-Request-Id`).

## Task Scheduling (Cron)

Lumora provides a declarative scheduling framework for background tasks:

- Configured directly inside `lumora.config.ts` via the `schedule` array.
- Uses `Bun.cron` under the hood.
- Tracks in-flight executions so `lumora.stop()` / `lumora.shutdown()` gracefully awaits active cron jobs before closing the database.

## Migration model

Lumora ships a file-based and SFE-compatible, mode-aware migration engine. No ORM, no migration DSL — plain SQL files that are version-tracked in a `_migrations` ledger table with SHA-256 checksum verification across both `status()` and `applyPending()`.

### File naming

```
YYYYMMDD_NNN_description.sql
```

### Mode-aware behavior

| `config.mode`   | Default `migrations.mode` | Startup behavior                                          |
|---|---|---|
| `development`   | `"auto"`                  | Apply pending migrations on startup (schema changed or fresh start) |
| `production`    | `"strict"`                | Fail startup if any pending migration exists or if any applied checksum mismatches |
| `test`          | `"off"`                   | Skip engine entirely — no FS reads, no table creation    |

### Production Safety (`RFC-03` / `LP-03`)

In production mode, `migrations.blockDestructive: true` is enabled by default, blocking `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, and `DELETE FROM`.

## Cryptographic Hash-Chained Audit Logs (`RFC-05`)

Lumora supports tamper-evident SHA-256 hash chaining on `_audit_logs` across SQLite, MySQL, and PostgreSQL:

- Enable via `audit: true` or `audit: { hashChain: true }` on a resource, or globally via `database.auditHashChain: true`.
- Uses monotonic UUIDv7 IDs, canonical JSON key sorting (`canonicalJson`), `tenant_id`, `changed_fields`, `previous_hash`, and `chained_hash`.
- Verify ledger integrity at any time via `await lumora.database.verifyAuditChain(tenantId?)`.

## Pagination, Delta Sync & Idempotency (`RFC-09`)

- **Delta Queries (`?since=`)**: Resource list endpoints natively support `?since=<ISO-timestamp>` (filtering `updated_at >= since`) as well as direct filtering on `id`, `created_at`, and `updated_at`.
- **Idempotency Middleware**: Exported `idempotency({ store: "memory" | "database", ttlMs, required })` middleware deduplicates retried `POST`/`PUT`/`PATCH` mutations by `Idempotency-Key` and SHA-256 payload hash, returning `409 IDEMPOTENCY_CONFLICT` if a key is reused with a different payload.

## Governance & Procedural Guardrails (`RFC-08` & `RFC-10`)

- **Record-Level Policy**: `permissions.allowRecord(auth, record)` is enforced across `GET /:id`, `PUT/PATCH /:id`, and `DELETE /:id`.
- **Composable Governance Middlewares**: `requirePolicy`, `enforceSoD` (Segregation of Duties: creator !== approver), `requireThreshold` (monetary delegation tiers), and `requireTimeWindow` (fiscal period / window locks).
- **Observability & Graceful Drain**: Built-in `/__lumora/health` (live DB `SELECT 1` readiness + latency), `/__lumora/metrics` (JSON and `?format=prometheus`), and `lumora.stop()` / `lumora.shutdown()` graceful drain.

