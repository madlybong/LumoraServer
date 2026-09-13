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

## Near term

- polish the `bunx init @astrake/lumora-server` experience
- improve generated docs UI beyond the current simple dev page
- strengthen JWT validation ergonomics (refresh tokens, revocation)
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
