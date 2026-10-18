# Changelog

## Unreleased

---

## [0.9.0] — 2026-10-18

### ⚠ Breaking & Behavioral Changes (`0.8.10` → `0.9.0`) & Consumer Migration Guide

No existing public functions, classes, or config keys were removed or renamed. However, **10 runtime, SQL, and HTTP behaviors** were hardened in `v0.9.0`:

1. **`mountModule()` Inherits Global `config.rateLimit` (`src/runtime.ts`):**
   - **Previous (`0.8.10`):** `lumora.mountModule(path, router, options)` ignored global `config.rateLimit.enabled: true` unless `options.rateLimit` was explicitly passed.
   - **Current (`0.9.0`):** Mounted sub-routers automatically inherit global `config.rateLimit` when `config.rateLimit.enabled` is `true` (and guard both `moduleBase` and `${moduleBase}/*`).
   - **Migration:** Pass `{ rateLimit: false }` or `{ rateLimit: { disabled: true } }` to `mountModule()` on sub-routers that should bypass global rate limiting.
2. **SQLite Connections Enable `PRAGMA foreign_keys = ON` and `WAL` by Default (`src/db.ts`):**
   - **Previous (`0.8.10`):** `LumoraDatabase.connect()` did not execute SQLite `PRAGMA` statements (`foreign_keys` defaulted to `OFF`, `journal_mode` to `DELETE`).
   - **Current (`0.9.0`):** `connect()` automatically executes `PRAGMA journal_mode = WAL` (`MEMORY` for `:memory:`), `PRAGMA busy_timeout = 5000`, `PRAGMA synchronous = NORMAL`, `PRAGMA foreign_keys = ON`, and `PRAGMA cache_size = -64000`.
   - **Migration:** Ensure foreign key parent rows exist before inserting child rows, or override via `database: { client: "sqlite", url: "...", pragmas: { foreignKeys: false } }`.
3. **`permissions.allowRecord` Enforced on Single-Record Routes & Early `404` on `PUT`/`PATCH` (`src/runtime.ts`):**
   - **Previous (`0.8.10`):** `permissions.allowRecord` was declared in `types.ts` but never invoked at runtime. `PUT /:id` and `PATCH /:id` ran `hooks.beforeUpdate` before checking if the record existed.
   - **Current (`0.9.0`):** `GET /:id`, `PUT /:id`, `PATCH /:id`, and `DELETE /:id` invoke `await resource.permissions.allowRecord(auth, record)` and return `403 Forbidden` when `false`. `PUT`/`PATCH /:id` checks record existence and returns `404 Not found` before invoking `hooks.beforeUpdate`.
4. **`database.list()` Enforces `excludeFields`, `hidden`, and `multiTenancy` (`src/db.ts`):**
   - **Previous (`0.8.10`):** `database.list()` ran `SELECT *` (ignoring `excludeFields` and `hidden`) and did not append `WHERE tenant_id = ...` when `this.tenantId` was set on the `LumoraDatabase` instance.
   - **Current (`0.9.0`):** `database.list()` projects only non-hidden, non-excluded columns via `buildSelectClause()` and appends the `multiTenancy.tenantIdField` filter whenever `this.multiTenancy?.enabled && this.tenantId` is truthy.
5. **Migration Checksum Verification in `status()` & `TRUNCATE` Blocked (`src/migrations.ts`):**
   - **Previous (`0.8.10`):** `migrations.status()` (used in `production` `strict` mode) did not verify SHA-256 checksums of already-applied migrations when `pending.length === 0`. `blockDestructive` allowed `TRUNCATE`.
   - **Current (`0.9.0`):** `migrations.status()` verifies SHA-256 checksums for all applied migrations and throws on mismatch even when `pending.length === 0`. `blockDestructive: true` now blocks `TRUNCATE`.
6. **`GET /health` Executes Live DB `SELECT 1` Readiness Probe (`src/runtime.ts`):**
   - **Previous (`0.8.10`):** `GET /health` returned static `200 OK` without querying the database.
   - **Current (`0.9.0`):** `GET /health` and `GET /__lumora/health` execute `SELECT 1`, include `status`, `uptimeSeconds`, and `database: { status, client, latencyMs }`, and return HTTP `503` if the database is unreachable or closed.
7. **OpenAPI `/events` and `/ws` Paths Gated on `realtime.enabled` (`src/docs.ts`):**
   - **Previous (`0.8.10`):** `/__lumora/openapi.json` listed `/{resource}/events` and `/{resource}/ws` even when `realtime.enabled` was `false`.
   - **Current (`0.9.0`):** `buildOpenApiDocument()` only includes SSE and WebSocket paths when `config.realtime.enabled === true`.
8. **Realtime SSE `id:` Sequence Prefix & Tenant/Scope Isolation (`src/realtime.ts`):**
   - **Previous (`0.8.10`):** SSE frames had no `id:` field, and resource SSE/WS broadcasts were delivered to all connected clients regardless of `tenantId` or `permissions.scope`.
   - **Current (`0.9.0`):** SSE frames prepend `id: <seq>\n`, and `realtime.publish()` filters resource events by the subscriber's `tenantId` and `permissions.scope`.
9. **Default Security Headers on All Responses (`src/runtime.ts`, `src/rate-limit.ts`):**
   - **Current (`0.9.0`):** All responses include `X-Request-Id`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`. Rate-limited routes include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After`.
10. **Reserved `?since=` Delta Query Parameter & `mountModule({ audit: true })` Action Values (`src/db.ts`, `src/runtime.ts`):**
    - **Current (`0.9.0`):** `?since=<ISO>` filters `updated_at >= since`. `mountModule({ audit: true })` writes normalized actions (`"create"`, `"update"`, `"delete"`) instead of raw HTTP verbs, and `writeAuditLog()` generates monotonic UUIDv7 IDs.

### Added

- **RFC-01 (Custom Auth, Dual-Token Rotation & Claim Mapping):** Added `auth.mode: "custom"` (`verify(c)` + `afterVerify`), `auth.publicPaths`, JWT `claimMapping` (`subject`, `roles`, `tenantId`, `scopes`), `refreshSecret`, `signLumoraJwt()`, and `rotateLumoraTokens()` (`400120f`).
- **RFC-02 (Enterprise SQLite Pragmas):** Added automatic SQLite `WAL`, `busy_timeout = 5000`, `synchronous = NORMAL`, `foreign_keys = ON`, `cache_size = -64000` on `connect()`, configurable via `database.pragmas`, plus `PRAGMA wal_checkpoint(TRUNCATE)` on `close()` (`400120f`).
- **RFC-03 (Atomic SQLite Backups & Restore):** Upgraded `backupSqliteDatabase()` with atomic `VACUUM INTO`, `maxRetainedBackups` retention pruning, and `restoreSqliteBackup()` auto-restore on migration failure (`400120f`).
- **RFC-04 (Rate Limiting & Security Headers):** Added global `config.rateLimit` inheritance on `mountModule()`, memory store TTL key pruning, `X-RateLimit-*` / `Retry-After` headers, and baseline security headers (`400120f`).
- **RFC-05 (Cryptographic SHA-256 Hash-Chained Audit Ledger):** Added opt-in hash chaining (`auditHashChain`, `audit: { hashChain: true }`) across SQLite, MySQL, and PostgreSQL with `tenant_id`, `previous_hash`, `chained_hash`, `canonicalJson()`, UUIDv7 IDs, and `database.verifyAuditChain(tenantId?)` (`400120f`).
- **RFC-06 (Tenant-Partitioned Realtime, Heartbeats & Replay):** Added `realtime.publishToTenant()`, `realtime.createTenantSseResponse()`, automatic tenant/scope filtering on resource SSE/WS streams, configurable `: ping\n\n` heartbeats (`heartbeatIntervalMs`), and `Last-Event-ID` ring-buffer replay (`maxReplayBuffer`) (`400120f`).
- **RFC-07 (Sub-Router OpenAPI 3.1.0 Introspection):** Re-exported `OpenAPIHono`, `createRoute`, and `z` from `@hono/zod-openapi` and added automatic sub-router OpenAPI 3.1.0 + Hono `router.routes` merging in `mountModule()` (`400120f`).
- **RFC-08 (Declarative Governance Middlewares):** Enforced `permissions.allowRecord` on single-record CRUD routes and exported `requirePolicy()`, `enforceSoD()`, `requireThreshold()`, and `requireTimeWindow()` middlewares (`400120f`).
- **RFC-09 (Delta Sync Queries & Idempotency Middleware):** Added `?since=<ISO>` delta query support, built-in `id`/`created_at`/`updated_at` filtering, and exported `idempotency()` middleware with memory and database (`_idempotency_keys`) stores and SHA-256 payload conflict detection (`400120f`).
- **RFC-10 (Observability & Graceful Drain):** Upgraded `/health` and `/__lumora/health` with live DB `SELECT 1` latency probes, added `/__lumora/metrics` (JSON & Prometheus exposition formats), and added `lumora.stop()` / `lumora.shutdown()` graceful drain for cron jobs, SSE/WS streams, and SQLite WAL checkpoints (`400120f`).

### Fixed

- Enforced `resource.excludeFields` and `field.hidden` SQL projection in `LumoraDatabase.list()` (`400120f`).
- Enforced `multiTenancy` tenant filtering on direct `LumoraDatabase.list()` calls (`400120f`).
- Removed PostgreSQL's restrictive `_audit_logs_action_check` constraint so custom procedural audit actions succeed on PostgreSQL (`400120f`).
- Escaped single quotes and awaited table initialization in `PostgresRateLimitStore.increment()` (`400120f`).
- Added expired-entry pruning to `MemoryRateLimitStore` to prevent unbounded memory growth (`400120f`).
- Typed `c.var.ok`, `c.var.list`, and `c.var.created` in `LumoraHonoVariables` with Hono's `TypedResponse` for `OpenAPIHono.openapi()` compatibility (`400120f`).

### File-by-File Changelog (`packages/core`)

| File | Summary of Changes (`0.8.10` → `0.9.0`) |
| :--- | :--- |
| `packages/core/package.json` | Added `@hono/zod-openapi@^1.6.3` and `zod@^4.6.7` dependencies; bundled `llms.txt`, `llms-full.txt`, and `AGENTS.md` alongside `README.md` and `CHANGELOG.md` in `files` and `prepack`/`postpack`. |
| `packages/core/src/types.ts` | Added `JwtClaimMapping`, `SqlitePragmasConfig`, `auth.mode: "custom"`, `publicPaths`, `refreshSecret`, `auditHashChain`, `MountModuleOptions`, `AuditChainVerifyResult`, `stop()`, `c.var.db`, `c.var.logAudit`, and `TypedResponse` return types on `c.var.ok`/`list`/`created`. |
| `packages/core/src/config.ts` | Resolved `realtime.heartbeatIntervalMs` (default `25000`) and `realtime.maxReplayBuffer` (default `100`); validated `auth.mode: "custom"` requires a `verify` function while keeping `auth.mode: "disabled"` blocked in `production`. |
| `packages/core/src/auth.ts` | Added `signLumoraJwt()`, `rotateLumoraTokens()`, `claimMapping` extraction (`subject`, `roles`, `tenantId`, `scopes`), `auth.mode: "custom"` execution in `resolveAuthFromContext()`, and issuer/audience options in `verifyJwtToken()`. |
| `packages/core/src/db.ts` | Added SQLite connection pragmas (`connect()`) and WAL checkpoint (`close()`), `?since=` delta filtering, `id`/`created_at`/`updated_at` filtering & sort normalization, `excludeFields` projection, `list()` multi-tenancy scoping, UUIDv7 `monotonicUuid()`, `canonicalJson()`, SHA-256 hash-chained `writeAuditLog()`, and `verifyAuditChain()`. |
| `packages/core/src/sqlite-backup.ts` | Added `SqliteBackupOptions`, atomic `VACUUM INTO` backup execution with `copyFile` fallback, `maxRetainedBackups` pruning, and `restoreSqliteBackup()`. |
| `packages/core/src/migrations.ts` | Added SHA-256 checksum verification for applied migrations in `status()`, `TRUNCATE` detection in `blockDestructive`, and automatic SQLite backup restore in `applyPending()` on migration failure. |
| `packages/core/src/rate-limit.ts` | Added periodic expired-key pruning in `MemoryRateLimitStore`, `initPromise` awaiting and SQL escaping in `PostgresRateLimitStore`, and `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` response headers. |
| `packages/core/src/middleware.ts` | Added governance middlewares (`requirePolicy`, `enforceSoD`, `requireThreshold`, `requireTimeWindow`) and `idempotency()` middleware with `MemoryIdempotencyStore` and database `_idempotency_keys` store. |
| `packages/core/src/realtime.ts` | Added `publishToTenant()`, `createTenantSseResponse()`, `close()`, SSE `: ping\n\n` heartbeats, `Last-Event-ID` ring-buffer replay, monotonic `id:` sequence numbers, and tenant/scope filtering on resource SSE/WebSocket streams. |
| `packages/core/src/docs.ts` | Gated `/{resource}/events` and `/{resource}/ws` paths in `buildOpenApiDocument()` on `config.realtime.enabled`. |
| `packages/core/src/scheduler.ts` | Tracked in-flight cron job promises and updated `SchedulerHandle.stop()` to `Promise<void>` awaiting `Promise.allSettled(inFlight)`. |
| `packages/core/src/runtime.ts` | Wired `afterVerify` across all auth modes, `publicPaths` exemptions, `c.var.db`/`c.var.logAudit`, global security headers, `permissions.allowRecord` enforcement, `mountModule` rate-limit inheritance & OpenAPI 3.1.0 introspection, `/__lumora/health`, `/__lumora/metrics`, and `stop()`/`shutdown()`. |
| `packages/core/src/index.ts` | Exported `OpenAPIHono`, `createRoute`, `z`, `backupSqliteDatabase`, `restoreSqliteBackup`, and all new auth/governance/idempotency utilities. |
| `packages/core/src/init-wizard.ts` | Updated generated `.cursorrules` and `llms.txt` in `scaffoldLumoraProject()` with `v0.9.0` procedural, governance, and OpenAPI guardrails. |

---

## [0.8.10] — 2026-10-07

### Added

- add procedural guardrails and response envelopes (`9ec00fb`)

### Fixed

- resolve CodeQL and Dependabot alerts (`03ebcb3`)

### Maintenance

- bump version to 0.8.9 (`643e554`)
- update CHANGELOG for v0.8.8 (`c05d3db`)
- bump version to 0.8.8 (`78e9f59`)
- update CHANGELOG for v0.8.7 (`9cda126`)
- bump version to 0.8.7 (`c271d5f`)
- update CHANGELOG for v0.8.6 (`55e17da`)
- bump version to 0.8.6 (`80a1aae`)
- update CHANGELOG for v0.8.5 (`292a877`)
- bump version to 0.8.5 (`de1324a`)

---

## [0.8.9] — 2026-10-06

### Added

- add procedural guardrails and response envelopes (`9ec00fb`)

### Maintenance

- bump version to 0.8.9 (`643e554`)

---

## [0.8.8] — 2026-09-13

### Security

- Resolved CodeQL ReDoS vulnerability warnings in `resource.ts` and `docs.ts` by refactoring trim regex (`03ebcb3`)
- Resolved CodeQL URL sanitization warning in AI tests with strict hostname matching (`03ebcb3`)
- Bumped `nodemailer` to `^10.0.9` to permanently resolve DoS, SSRF, and domain allow-list bypass vulnerabilities (`03ebcb3`)

### Maintenance

- update CHANGELOG for v0.8.7 (`9cda126`)
- bump version to 0.8.7 (`c271d5f`)
- update CHANGELOG for v0.8.6 (`55e17da`)
- bump version to 0.8.6 (`80a1aae`)
- update CHANGELOG for v0.8.5 (`292a877`)
- bump version to 0.8.5 (`de1324a`)


---

## [0.8.7] — 2026-09-13

### Fixed

- Remove `npm config set` from release workflow to fix `ENOWORKSPACES` error when publishing from workspace folder (`packages/core`)

### Maintenance

- bump version to 0.8.7 (`c271d5f`)

---

## [0.8.6] — 2026-09-13

### Maintenance

- Test release to verify the updated NPM authentication token in the CI pipeline
- bump version to 0.8.6 (`80a1aae`)

---

## [0.8.5] — 2026-09-13

### Fixed

- fix npm authentication in release workflow to properly resolve token on user config and avoid workspace config warnings
- fix starter build resolution for hono dependency
- add unified validation script (`bun run validate`) for CI parity

### Maintenance

- bump version to 0.8.5 (`de1324a`)

---

## [0.8.4] — 2026-09-13

### Added

- LP-04 — afterVerify hook and customClaims declaration (`1ac9f68`)
- LP-01 — add sfe-prep command to embed migrations (`b2c1146`)
- LP-02 — auto-backup SQLite databases before running migrations (`8eca879`)
- LP-05 — realtime endpoints are now opt-in (`ab9546c`)
- LP-03 — production defaults blockDestructive to true (`c2f7ca1`)
- implement rate limiting, pagination, batch resolution, audit logging, and filter operators for v0.8.1 (`4bb5446`)

### Fixed

- inject npm auth token directly and publish tarball to resolve 404 (`82cc4be`)
- resolve lumora.config.ts relative to import.meta.dir (`d04f836`)

### Changed

- standardize config shapes, inject LLM compatibility matrices, and remove legacy schemas (`6f5584d`)

### Maintenance

- update CHANGELOG for v0.8.3 (`855aac8`)
- bump version to 0.8.3 (`5e344ce`)
- update CHANGELOG for v0.8.2 (`e92eb97`)
- bump version to 0.8.2 (`7a75fa9`)
- update CHANGELOG for v0.8.1 (`11d19da`)
- bump version to 0.8.1 (`9f9057a`)
- update CHANGELOG for v0.8.0 (`8a04a13`)


---

## [0.8.3] — 2026-09-13

### Added

- LP-04 — afterVerify hook and customClaims declaration (`1ac9f68`)
- LP-01 — add sfe-prep command to embed migrations (`b2c1146`)
- LP-02 — auto-backup SQLite databases before running migrations (`8eca879`)
- LP-05 — realtime endpoints are now opt-in (`ab9546c`)
- LP-03 — production defaults blockDestructive to true (`c2f7ca1`)

### Changed

- standardize config shapes, inject LLM compatibility matrices, and remove legacy schemas (`6f5584d`)

### Maintenance

- bump version to 0.8.3 (`5e344ce`)


---

## [0.8.3] — 2026-09-13

### Added

- LP-04 — afterVerify hook and customClaims declaration (`144e644`)
- LP-01 — add sfe-prep command to embed migrations (`d765ff7`)
- LP-02 — auto-backup SQLite databases before running migrations (`4e5ed85`)
- LP-05 — realtime endpoints are now opt-in (`1179645`)
- LP-03 — production defaults blockDestructive to true (`5332606`)
- implement rate limiting, pagination, batch resolution, audit logging, and filter operators for v0.8.1 (`4bb5446`)

### Fixed

- resolve lumora.config.ts relative to import.meta.dir (`d04f836`)

### Changed

- standardize config shapes, inject LLM compatibility matrices, and remove legacy schemas (`cb696c8`)

### Maintenance

- bump version to 0.8.2 (`7a75fa9`)
- bump version to 0.8.1 (`9f9057a`)


---

## [0.8.2] — 2026-08-09

### Maintenance

- bump version to 0.8.2 (`7a75fa9`)


---

## [0.8.2] — 2026-08-09

### Added

- implement rate limiting, pagination, batch resolution, audit logging, and filter operators for v0.8.1 (`4bb5446`)

### Fixed

- resolve lumora.config.ts relative to import.meta.dir (`d04f836`)

### Maintenance

- bump version to 0.8.1 (`9f9057a`)


---

## [0.8.1] — 2026-08-08

### Added

- **LP-01**: SFE binary embedded migrations via `sfe-prep` CLI and `embeddedFiles` config.
- **LP-02**: SQLite automatic `.bak` backups before migration apply (`autoBackup`).
- **LP-03**: Production-safe migration defaults (`blockDestructive: true`).
- **LP-04**: Custom JWT claims extraction and `afterVerify` lifecycle hooks in auth config.
- **LP-05**: Opt-in Realtime routes (`realtime: { enabled: true }`).

### Fixed

- resolve lumora.config.ts relative to import.meta.dir (`d04f836`)

### Maintenance

- bump version to 0.8.1 (`9f9057a`)


---

## [0.8.1] — 2026-08-08

### Added

- implement rate limiting, pagination, batch resolution, audit logging, and filter operators for v0.8.1 (`4bb5446`)


---

## [0.8.1] — 2026-08-08

_No conventional commits found in this range._


---

## [0.8.0] — 2026-08-08

### Added

- v0.8.0 release with rate limits, cron jobs, and multi-tenancy (`4502fe8`)


---

## [0.8.0] — 2026-08-08

### Added

- implement RFC-01 through RFC-06 features (`1af69c0`)
- add PostgreSQL adapter via bun:postgres (LUR-001) (`99a0f03`)

### Fixed

- correct PostgreSQL search_path and timestamp assertions (`b0b2186`)
- use PostgreSQL startup params for search_path, remove invalid min option (`06eac94`)
- correct bun:postgres onconnect hook signature (`b6706e1`)
- add PostgreSQL service to release workflow (`b7fa008`)

### Documentation

- update docs for v0.7.0 features (`e83e12a`)
- rewrite AGENTS.md, update rules, add skills playbook (`9e2b5f2`)

### Maintenance

- bump version to 0.7.0 (`cdee2ad`)
- bump version to 0.6.4 (`cb18577`)
- add tools/scratch/, local PG setup script, ignore release notes (`637a6bb`)
- update CHANGELOG for v0.6.3 (`418a644`)
- bump version to 0.6.3 (`b8a2331`)
- bump version to 0.6.2 (`07eae25`)
- bump version to 0.6.1 (`61aab2d`)
- bump version to 0.6.0 (`69283e9`)


---

## [0.7.0] — 2026-07-12

### Added

- implement RFC-01 through RFC-06 features (`1af69c0`)

### Documentation

- update docs for v0.7.0 features (`e83e12a`)
- rewrite AGENTS.md, update rules, add skills playbook (`9e2b5f2`)

### Maintenance

- bump version to 0.7.0 (`cdee2ad`)
- bump version to 0.6.4 (`cb18577`)
- add tools/scratch/, local PG setup script, ignore release notes (`637a6bb`)


---

## [0.7.0] — 2026-07-12

### Added

- implement RFC-01 through RFC-06 features (`f76d3ff`)
- add PostgreSQL adapter via bun:postgres (LUR-001) (`99a0f03`)

### Fixed

- correct PostgreSQL search_path and timestamp assertions (`b0b2186`)
- use PostgreSQL startup params for search_path, remove invalid min option (`06eac94`)
- correct bun:postgres onconnect hook signature (`b6706e1`)
- add PostgreSQL service to release workflow (`b7fa008`)

### Maintenance

- bump version to 0.6.4 (`f6ffb52`)
- add tools/scratch/, local PG setup script, ignore release notes (`637a6bb`)
- bump version to 0.6.3 (`b8a2331`)
- bump version to 0.6.2 (`07eae25`)
- bump version to 0.6.1 (`61aab2d`)
- bump version to 0.6.0 (`69283e9`)


---

## [0.7.0] — 2026-07-12

### Added

- add PostgreSQL adapter via bun:postgres (LUR-001) (`99a0f03`)

### Fixed

- correct PostgreSQL search_path and timestamp assertions (`b0b2186`)
- use PostgreSQL startup params for search_path, remove invalid min option (`06eac94`)
- correct bun:postgres onconnect hook signature (`b6706e1`)
- add PostgreSQL service to release workflow (`b7fa008`)

### Maintenance

- bump version to 0.6.4 (`f6ffb52`)
- add tools/scratch/, local PG setup script, ignore release notes (`637a6bb`)
- bump version to 0.6.3 (`b8a2331`)
- bump version to 0.6.2 (`07eae25`)
- bump version to 0.6.1 (`61aab2d`)
- bump version to 0.6.0 (`69283e9`)


---

## [0.6.4] — 2026-07-12

### Added

- add PostgreSQL adapter via bun:postgres (LUR-001) (`99a0f03`)

### Fixed

- correct PostgreSQL search_path and timestamp assertions (`b0b2186`)
- use PostgreSQL startup params for search_path, remove invalid min option (`06eac94`)
- correct bun:postgres onconnect hook signature (`b6706e1`)
- add PostgreSQL service to release workflow (`b7fa008`)

### Maintenance

- add tools/scratch/, local PG setup script, ignore release notes (`637a6bb`)
- bump version to 0.6.3 (`b8a2331`)
- bump version to 0.6.2 (`07eae25`)
- bump version to 0.6.1 (`61aab2d`)
- bump version to 0.6.0 (`69283e9`)


---

## [0.6.3] — 2026-05-28

### Added

- add PostgreSQL adapter via bun:postgres (LUR-001) (`99a0f03`)

### Fixed

- correct PostgreSQL search_path and timestamp assertions (`b0b2186`)
- use PostgreSQL startup params for search_path, remove invalid min option (`06eac94`)
- correct bun:postgres onconnect hook signature (`b6706e1`)
- add PostgreSQL service to release workflow (`b7fa008`)

### Maintenance

- bump version to 0.6.3 (`b8a2331`)
- bump version to 0.6.2 (`07eae25`)
- bump version to 0.6.1 (`61aab2d`)
- bump version to 0.6.0 (`69283e9`)


---

## [0.6.3] — 2026-05-28

### Added

- add PostgreSQL adapter via bun:postgres (LUR-001) (`99a0f03`)

### Fixed

- correct PostgreSQL search_path and timestamp assertions (`b0b2186`)
- use PostgreSQL startup params for search_path, remove invalid min option (`06eac94`)
- correct bun:postgres onconnect hook signature (`b6706e1`)
- add PostgreSQL service to release workflow (`b7fa008`)

### Maintenance

- bump version to 0.6.2 (`07eae25`)
- bump version to 0.6.1 (`61aab2d`)
- bump version to 0.6.0 (`69283e9`)


---

## [0.6.2] — 2026-05-28

### Added

- add PostgreSQL adapter via bun:postgres (LUR-001) (`99a0f03`)

### Fixed

- use PostgreSQL startup params for search_path, remove invalid min option (`06eac94`)
- correct bun:postgres onconnect hook signature (`b6706e1`)
- add PostgreSQL service to release workflow (`b7fa008`)

### Maintenance

- bump version to 0.6.1 (`61aab2d`)
- bump version to 0.6.0 (`69283e9`)


---

## [0.6.1] — 2026-05-28

### Added

- add PostgreSQL adapter via bun:postgres (LUR-001) (`99a0f03`)

### Fixed

- correct bun:postgres onconnect hook signature (`b6706e1`)
- add PostgreSQL service to release workflow (`b7fa008`)

### Maintenance

- bump version to 0.6.0 (`69283e9`)


---

## [0.6.0] — 2026-05-28

### Added

- add PostgreSQL adapter via bun:postgres (LUR-001) (`0179c17`)
- add mode-aware migration engine (`9a9108b`)

### Maintenance

- bump version to 0.5.1 (`4c0cdc6`)


---

## [0.5.1] — 2026-05-23

### Added

- add mode-aware migration engine (`9a9108b`)

### Maintenance

- bump version to 0.5.1 (`4c0cdc6`)


---

## [0.5.1] — 2026-05-23

### Added

- add mode-aware migration engine (`9a9108b`)

## [0.5.0] — 2026-05-22

### Added

#### LS-1: Computed Fields
- `computed` property on resource definitions — declare virtual fields via `resolve(record, ctx)` functions
- Computed fields are included in GET responses and omitted from POST/PATCH payloads

#### LS-2: Relational Joins
- `relations` property on resource definitions — declare `belongsTo` and `hasMany` associations with `foreignKey` and `matchOn` support
- `?include=rel1,rel2` query parameter resolves declared relations on GET_LIST and GET_ONE responses
- `database.getByField()` and `database.listByField()` helpers for direct cross-resource lookups

#### LS-3: File Upload / Media Attachments
- New `"file"` and `"file[]"` field types added to the `FieldType` union
- `handleFileUpload()` in `upload.ts` — multipart form data handler (zero external deps)
- Uploaded files stored as URL strings; served via `GET /{resource}/{id}/files/{field}`

#### LS-4: Bulk Operations
- `POST /{resource}/bulk` route — creates multiple records in a single transactional operation
- Returns per-item success/failure details; rolls back the full batch on validation errors

#### LS-5: CSV Export (no-deps)
- `GET /{resource}/export/csv` — streams RFC 4180 compliant CSV response
- Respects `?filter=`, auth, and scope; excludes `hidden` fields from output
- `export.ts` — pure CSV engine (zero external deps)

#### LS-6: Namespaced Resource Events
- All `db:create`, `db:update`, `db:delete` events now emit with resource-namespaced keys (e.g. `resource:post:created`)
- Original generic events preserved for backward compatibility

#### LS-7: Realtime Broadcast
- `realtime.broadcast(topic, data)` convenience method added to `LumoraRealtime`
- Pushes custom payloads to all connected SSE and WebSocket clients on a topic

#### LS-8: Background Scheduler
- `schedule` config array accepting `{ cron, handler, name, maxRetries, timezone }` task definitions
- `scheduler.ts` — `Bun.cron`-based scheduler with per-task retry logic and structured logging
- Exposed as `instance.scheduler` for graceful shutdown via `instance.scheduler.stop()`

#### LS-9: Store-Scoped Permissions
- `scope` on `ResourcePermissions` — bind resource rows to JWT-extracted `auth.scope` values
- Scope injection adds a non-bypassable WHERE clause to all LIST, CREATE, UPDATE, DELETE operations
- Auth module extended to extract `scope` from JWT claims

#### LS-10: AI Gateway (multi-provider)
- Provider support: `gemini`, `openai`, `anthropic` (Claude), `kilo` (OpenAI-compat), `custom`
- `ai.chat({ messages, provider?, model?, responseFormat? })` — multi-turn chat interface
- `ai.getUsage({ provider?, since? })` — aggregate token usage and cost stats
- Token usage tracking to `_ai_usage_log` table when `tokenTracking: true`
- Built-in pricing table per model (Gemini, GPT, Claude) with per-config cost overrides

#### LS-11: Structured Query Interface
- `instance.query.execute(descriptor, context)` — schema-validated structured query executor
- Validates resource existence and filter fields (rejects unknown fields — no raw SQL)
- Supports filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `in`
- Integrates scope injection (LS-9), computed fields (LS-1), and relational includes (LS-2)
- All loaded resource definitions exposed on `instance.resources`

### Improved

- `LumoraConfig.routes` is now optional; `resources` array can be provided directly for programmatic or test usage (avoids ESM module cache issues in Bun parallel test runs)
- Logger: replaced `✗` (U+2717) with `✘` (U+2718) in request error and banner output to prevent Bun test runner from misinterpreting log output as test failures
- Auth errors (expired tokens, missing headers) now emit `logger.event` instead of `logger.error` for expected failure paths

### Maintenance

- Version synced to `0.5.0` across all workspace packages
- Test suite expanded to **103 tests** across 27 files (was 33 at v0.2.1)

---

## [0.2.1] — 2026-05-11

### Fixed

- resolve TS strict-mode errors and ship declaration files (`8c36d96`)

### Maintenance

- update CHANGELOG for v0.1.7 (`e8bccf4`)


---

## [0.2.0] — 2026-04-29

### Added

- **First-class PATCH Route**: Added native `app.patch()` route handlers to support partial updates across all resources.
- **COUNT + total in list response**: Added parallel database queries during listing to compute and return the `total` number of matching records in paginated GET requests.
- **`?search=` queries**: Built-in support for performing case-insensitive SQL `LIKE` queries on `searchable` resource fields.
- **`?limit=` alias**: Enabled `limit` as a query parameter alias for `pageSize` to align with client-side conventions.
- **JWT `exp` validation**: Integrated expiration checks into `verifyJwt()`, closing a security gap where expired tokens were previously accepted if signature verification succeeded.
- **Field-level `hidden` attribute**: Added `hidden` schema option to fields (e.g. `password_hash`) to exclude them dynamically from GET responses.
- **Field-level `readOnly` attribute**: Added `readOnly` schema option to fields to prevent client mutations on sensitive properties (like approval markers or created/updated timestamps).
- **Declarative `roles` shorthand**: Added native RBAC checks directly under the resource schema's `permissions.roles` config (e.g., `POST: ["admin"]`), avoiding repetitive boilerplate role check blocks.
- **`PATCH` permission type**: Added separate checking for the `"PATCH"` ResourceMethod to decouple partial updates from full PUT overrides.
- **Database access in hook contexts**: Exposed `database` directly inside `ResourceHookContext`, enabling cross-resource writes and multi-table transactions.
- **CORS middleware support**: Built-in CORS configuration (`cors: { origin, methods, headers, credentials }` in `lumora.config.ts`), with dev-mode defaults to `*`.
- **Unique constraints & indexes**: Supported `unique: true` and `indexed: true` on fields to automatically build database-level UNIQUE constraints and indexes during table generation.
- **0.2.0 framework refactor**: Large scale cleanup consolidating the slim, resource-first runtime model and upstreaming all critical custom local patches (`40a2bf5`).

### Maintenance

- v0.2.0 release and sync (`2eda367`)


---

## [0.1.7] — 2026-04-28

### Added

- **Structured Dev-Server Logger**: Added a built-in zero-dependency terminal logger. In `development` mode, it prints a rich ASCII startup banner showing port, DB, and resource routes, followed by a colored per-request HTTP access log with duration and status.
- **Configurable Logging Levels**: Added `logging: { level: "silent" | "minimal" | "verbose" }` to `LumoraConfig`. Defaults to `verbose` in dev, `minimal` in prod (startup/errors only), and `silent` in tests.
- **Exposed Database Access**: `LumoraInstance` now exposes the internal `database` property (`LumoraDatabase`), allowing parent applications to perform custom raw SQL queries directly using the internal connection.
- **Exported `LumoraDatabase`**: Added `LumoraDatabase` class export from the public root index to allow for clean typing when parent apps access the internal database instance.

## [0.1.6] — 2026-04-25

### Added

- **Resource Permission Hooks**: Added per-method permission guards to `defineResource()` allowing developers to define `permissions` on a resource schema. The runtime enforces these via a `checkPermission` helper in all CRUD handlers, returning 403 if a guard throws or returns a Response.
- **Audit Trail**: Introduced automated system audit trails. When `audit: true` is set on a resource, the runtime automatically writes immutable logs to a system-managed `_audit_logs` table (SQL) covering `POST`, `PUT`, and `DELETE` actions.
- **SMTP Email Plugin**: Integrated an optional `email` service using `nodemailer`. Supports static credentials or DB-backed settings read dynamically at runtime.
- **AI Provider Plugin**: Added a lightweight, zero-SDK `ai` service wrapper that provides `complete()` and `test()` methods. Supports Gemini, OpenAI, and custom OpenAI-compatible base URLs.

---

## [0.1.5] — 2026-04-25

### Fixed

- ci workflow errors — npm publish auth and correct artifact path (`5cc73aa`)


---

## [0.1.4] — 2026-04-25

### Fixed

- prepack hook to include README and CHANGELOG in npm tarball (`9ab6b72`)


---

## [0.1.3] — 2026-04-25

### Maintenance

- fix CI pipeline failures (`489987c`)
- verify automated release pipeline (`773290b`)

All notable changes to `@astrake/lumora-server` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/) · Commits: [Conventional Commits](https://www.conventionalcommits.org/)


---

## [0.1.0] — 2026-04-25

### Added

- Initial release of `@astrake/lumora-server`
- `defineLumoraConfig(...)` — typed config definition and validation
- `defineResource(...)` — schema-first resource DSL
- `initLumora(configOrPath)` — runtime bootstrap, returns `LumoraInstance`
- File-based resource discovery with generated CRUD REST endpoints
- Generated SSE stream and WebSocket endpoint per resource
- Typed lifecycle, realtime, and DB transaction event emission
- Static token and HS256 JWT authentication modes
- SQLite (`bun:sql`) database adapter; MySQL as optional path
- Dev-mode OpenAPI 3.1.0 document generation and docs UI
- Interactive init wizard (`bunx init @astrake/lumora-server`)
- Reference starter app using `lumora.config.ts` and `routes/*.ts`
- `LICENSE` — MIT license (© 2026 Anuvab Chakraborty)
- `SECURITY.md` — responsible disclosure policy
- `docs/LEGAL.md` — full warranty disclaimer and legal notice
- `tools/changelog.ts` — automated changelog generator (zero npm deps)
- `tools/version.ts` — VERSION → all package.json sync
- GitHub Actions: `ci.yml` — install, version-check, typecheck, test, build, artifact upload
- GitHub Actions: `release.yml` — dual trigger (tag or VERSION bump), changelog commit, GitHub Release, npm publish
- GitHub Actions: `version-check.yml` — VERSION single-source-of-truth enforcement on PRs
- GitHub Actions: `codeql.yml` — weekly TypeScript security scan
- Bun install caching across all workflows
- Root scripts: `version:sync`, `version:check`, `changelog`, `release:prep`
- `README.md` — live CI/npm/license/Bun badges, usage examples, automation table, disclaimer
- `.gitignore` — comprehensive exclusions: `*.db`, `*.tgz`, `*.tsbuildinfo`, `coverage/`, `.env*`, `*.pem`, `*.key`, `*.log`
- `.npmrc` — `@astrake` scope, `git-tag-version=false`, `save-exact=false`
- Documentation set: `PROJECT.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`, `RELEASES.md`, `AI_AGENT_GUIDE.md`, `LEGAL.md`, `ROADMAP.md`
