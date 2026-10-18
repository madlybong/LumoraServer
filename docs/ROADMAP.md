# Roadmap

## Shipped in v0.5.0

The following capabilities landed across the v0.3.0–v0.5.0 releases:

- **LS-1** Computed / virtual fields on resources
- **LS-2** Relational joins (`belongsTo`, `hasMany`) with `?include=`
- **LS-3** File upload / media attachments (`file`, `file[]` field types)
- **LS-4** Bulk operations (`POST /{resource}/bulk`, transactional)
- **LS-5** CSV export engine (zero external deps)
- **LS-6** Namespaced resource event bus (`resource:{name}:created/updated/deleted`)
- **LS-7** Realtime broadcast (`realtime.broadcast(topic, data)`)
- **LS-8** Declarative scheduler DSL (`Bun.cron`-backed, retry + logging)
- **LS-9** Store-scoped permissions (scope-injected WHERE clause, non-bypassable)
- **LS-10** AI provider gateway (Gemini, OpenAI, Anthropic, Kilo, custom + usage tracking)
- **LS-11** Structured query executor (schema-validated, SQL-injection-safe)

---

## Shipped in v0.7.0

- Custom Hono router mounting via `mountModule` (RFC-01)
- Fine-grained PUT/PATCH separation via `updateMethod` (RFC-02)
- Procedural module context injection `createModuleContext` (RFC-03)
- Procedural `logAudit` helper (RFC-04)
- `rateLimit` middleware (RFC-05)
- Realtime query-token auth for SSE (RFC-06)

---

## Shipped in v0.8.0

- Database rate limiting store (`lumora_rate_limits` via PostgreSQL).
- Advanced declarative `schedule` framework with `lumora_cron_log` execution tracking.
- Schema migration ledger table (`_migrations`).
- Tenant ID scoping mechanisms.

---

## Shipped in v0.8.1

- Comprehensive audit logging (`audit: true`).
- Pagination metadata (`totalPages`, `hasNextPage`).
- Advanced filtering operators (`__gt`, `__lt`, `__in`, `__neq`, `__like`, `__ilike`).
- Batched query execution for relational includes (N+1 mitigation).

---

## Shipped in v0.8.2

- **LP-01** SFE binary embedded migrations via `sfe-prep` CLI.
- **LP-02** SQLite automatic `.bak` backups before migration apply.
- **LP-03** Production-safe migration defaults (`blockDestructive: true`).
- **LP-04** Custom JWT claims extraction and `afterVerify` lifecycle hooks.
- **LP-05** Opt-in Realtime routes (`realtime: { enabled: true }`).

---

## Shipped in v0.8.9 – v0.8.10

- Procedural route guardrails (`validate`, `c.var.ok/list/created`, `LumoraHttpError`, `db.page`).
- Secure `mountModule` options (`protected`, `roles`, `rateLimit`, `audit`).
- Multi-database transaction pooling (`AsyncLocalStorage`) and hardened PostgreSQL integration suite.

---

## Shipped in v0.9.0

- **RFC-01** Custom auth verifier (`auth.mode: "custom"`), `allowInProduction` for disabled auth, dual-token access + refresh rotation (`issueTokenPair`, `rotateTokens`, `revokeToken` via `_auth_refresh_tokens`), and `claimMapping` for multi-axis tenant/scope claims.
- **RFC-02** External database connection mode (`connectionMode: "external"`, `externalClient`) and automatic enterprise SQLite pragmas (`WAL`, `busy_timeout = 5000`, `synchronous = NORMAL`, `foreign_keys = ON`).
- **RFC-03** Drizzle Kit `_journal.json` migration loader (`drizzleJournal: true`) and atomic SQLite `VACUUM INTO` pre-migration backup with automatic file-copy rollback on migration failure.
- **RFC-04** Global HTTP pipeline middleware (`config.compression`, `config.etag`, `config.securityHeaders`) and global rate limiting across all mounted sub-routers.
- **RFC-05** Cryptographic SHA-256 hash-chained audit ledger (`chained_hash`, `previous_hash`, `changed_fields`, `canonicalJson`, `verifyAuditChain(db, tenantId)`).
- **RFC-06** Tenant-partitioned realtime channels (`publishToTenant`), SSE heartbeat comments (`heartbeatIntervalMs: 25000`), and ring-buffer `Last-Event-ID` replay (`maxReplayBuffer: 100`).
- **RFC-07** Sub-router OpenAPI 3.1.0 merging via `mountModule(prefix, router, { openApi })` and automatic `@hono/zod-openapi` (`OpenAPIHono`) introspection.
- **RFC-08** Declarative governance policy engine (`definePolicy`, `evaluatePolicy`, `assertPolicy`) for Segregation of Duties (SoD), monetary delegation thresholds (DoFP), and temporal period locks.
- **RFC-09** Offline-first idempotent mutation sync engine (`lumora.sync.processBatch` backed by `_sync_mutation_logs` with SHA-256 payload conflict detection and `?updated_since=` delta bootstrap).
- **RFC-10** Deep database readiness probe (`/__lumora/health` with `SELECT 1` latency), Prometheus + JSON telemetry (`/__lumora/metrics`), and idempotent graceful shutdown (`lumora.stop()`).

---

## Near term

- polish the `bunx @astrake/lumora-server init` experience
- improve generated docs UI beyond the current simple dev page
- add more runtime benchmarks and performance tuning guides

## Mid term

- more configurable docs generation (custom branding, grouping)
- better parent-app extension points around auth and realtime channels
- stronger DB adapter seams without bloating the public API
- metadata and runtime hooks needed for a future Administrator UI

## Future product track

- Administrator UI
- resource management surfaces for admin users
- richer operational tooling around generated APIs
- more polished publishing and project scaffolding experience

## Guardrails

- keep the framework slim
- do not reintroduce removed jobs/worker architecture casually
- do not rebuild large package sprawl without strong justification
- keep `lumora.config.ts` and `routes/*.ts` as the primary mental model
- prefer concrete runtime value over speculative abstraction
