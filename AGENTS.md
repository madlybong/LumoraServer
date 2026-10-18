# Lumora Agent Guide — `@astrake/lumora-server`

This is the short operating guide for AI coding agents working in this repository and in parent applications consuming `@astrake/lumora-server`.

## Mission & Architecture

`@astrake/lumora-server` is a slim framework, not a plugin-heavy platform. Keep the repo aligned with this model:
- One published package: `@astrake/lumora-server`
- One reference app: `apps/starter`
- One main workflow: typed config + file-based resources + generated runtime

Keep the public API focused (`defineLumoraConfig`, `defineResource`, `initLumora`, plus composable governance/validation/idempotency middlewares and `OpenAPIHono` re-exports). Prefer extending the existing runtime over reintroducing old package sprawl or removed plugin/container/jobs architecture. Keep resource files schema-first.

## First Places to Read & Change Heuristics

- `packages/core` (published framework package: typed config, runtime, auth, DB CRUD engine, realtime, docs, governance)
- `apps/starter` (reference Bun app showing config, routes, resources)
- Docs: `README.md`, `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `llms.txt`, `llms-full.txt`, `CHANGELOG.md`

**Change Pattern:**
1. If a change impacts the public framework surface, update shared types in `packages/core/src/types.ts` first.
2. Update runtime/routing in `packages/core/src/runtime.ts` or adjacent modules.
3. Demonstrate usage in `apps/starter`.
4. Add or update tests, then update docs.

## Agentic Hard Rules (The Fail-Safe Workflow)

To prevent broken releases, all agents MUST follow these mandatory patterns:

1. **The Three Environments:** You must reason about 3 environments:
   - **Local:** Runs all 165 tests across 37 files if `PG_URL` is configured in `.env`.
   - **CI Pull Request:** GitHub Actions with a real postgres service container.
   - **CI Release (main):** Triggers `npm publish` only after PR is green.
2. **Release Gate Rule:** Any commit touching `db.ts`, `pg-*.test.ts`, `.github/workflows/*.yml`, or `bun-types` boundaries MUST go through a branch + Pull Request with green CI before merging to `main`. Never push these directly to `main`.
3. **Type-First Research Rule:** Before writing any code that calls a native `bun:*` API, you MUST open and read the relevant `node_modules/bun-types/*.d.ts` file. Do not guess or use internet examples.
4. **Scratch File Policy:** Scratch and debug scripts must go in `tools/scratch/`. That directory's `.gitignore` prevents them from being committed. Clean up all scratch files before the final commit on any feature.

## Procedural Route Heuristics (v0.9.0+)

When developing custom non-CRUD routes mounted via `mountModule`, AI coders MUST adhere to the following guardrails:
1. **OpenAPI & Typing:** Prefer `new OpenAPIHono<{ Variables: LumoraHonoVariables }>()` (or `new Hono<{ Variables: LumoraHonoVariables }>()`) and register routes before dispatching requests so `mountModule()` automatically merges route specs into `/__lumora/openapi.json`.
2. **Validation:** Never manually parse JSON. Use the exported `validate({ json: ... })` middleware (or `createRoute` with `OpenAPIHono`) and consume typed inputs from `c.var.valid.json`.
3. **Standard Responses:** Never return raw un-enveloped JSON. Always use `c.var.ok(data, meta?)`, `c.var.list(data, meta)`, `c.var.created(data)`, `c.var.noContent()`, or `c.var.fail(code, msg, status)`.
4. **Error Boundaries:** Throw `LumoraHttpError` for controlled failures. Never leak raw stack traces. The global `app.onError` will catch it.
5. **Safe Database Reads:** When writing custom GET list endpoints with `db.sql`, always wrap your queries in `ctx.db.page(fragment, opts)` (or `c.var.db.page(...)`) to prevent un-paginated queries from crashing the process.
6. **Governance & Idempotency:** Use `idempotency({ store: "database" | "memory" })`, `enforceSoD()`, `requireThreshold()`, `requireTimeWindow()`, and `requirePolicy()` on sensitive procedural mutations.
7. **Secure Mounts:** Supply strict bounds to `mountModule`, passing `{ protected: true, roles: [...], rateLimit: true, audit: true, openApiTags: [...] }` when writing enterprise features.

## Safe Extension Heuristics

- **Resource Capabilities:** Extend resource types -> update generated runtime -> add starter example -> add tests -> update docs.
- **Auth/Docs Behavior:** Extend config types & validation -> update runtime -> verify starter -> update docs & tests. Dev can disable auth; production MUST require it (`static`, `jwt`, or `custom`).
- **DB Adapter/Engine:** Keep the adapter seam in `db.ts`. Prefer concrete SQLite/MySQL/PostgreSQL support over abstract ORMs. Keep transaction event emission semantics.

## Architectural Constraints (v0.9.0)

- **Config Shape:** The top-level config uses `api: { base, version }`, `database: { client, url }`, `auth: { mode }`, `routes: { dir }`. Do not hallucinate legacy `db:`, `auth.type:`, or `base:` properties.
- **Custom Auth & JWT Rotation (RFC-01):** `auth.mode: "custom"` supports custom `verify(c)` callbacks in production; `auth.mode: "jwt"` supports `claimMapping`, `refreshSecret`, `signLumoraJwt()`, and `rotateLumoraTokens()`. `auth.mode: "disabled"` is strictly blocked in `production`.
- **SQLite Pragmas & Atomic Backups (RFC-02/03):** File-based SQLite automatically enables `WAL`, `busy_timeout = 5000`, `synchronous = NORMAL`, `foreign_keys = ON`, and `cache_size = -64000`. `autoBackup: true` uses atomic `VACUUM INTO`, retention pruning (`maxRetainedBackups`), and auto-restore on migration failure.
- **Migrations (LP-01/03 & RFC-03):** Migrations must be file-based plain SQL or embedded via `sfe-prep`. `status()` verifies SHA-256 checksums of applied migrations. In production, `blockDestructive: true` blocks `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, and `DELETE FROM`.
- **Tamper-Evident Audit Ledger (RFC-05):** `auditHashChain: true` or `audit: { hashChain: true }` enables SHA-256 hash chaining verified via `database.verifyAuditChain(tenantId?)`.
- **Realtime (LP-05 & RFC-06):** SSE and WebSocket routes are strictly opt-in via `realtime: { enabled: true }`. Supports tenant isolation (`publishToTenant`, `createTenantSseResponse`), `: ping\n\n` heartbeats (`heartbeatIntervalMs`), and `Last-Event-ID` replay (`maxReplayBuffer`).
- **Observability & Shutdown (RFC-10):** `/health` and `/__lumora/health` execute live DB `SELECT 1` probes (`200` / `503`); `/__lumora/metrics` serves JSON and Prometheus telemetry; `lumora.stop()` / `lumora.shutdown()` gracefully drains cron jobs, realtime streams, and SQLite WAL checkpoints.

## Known Limitations (Do Not Over-Engineer)

- Basic Docs UI is intentionally simple.
- CRUD engine is schema-first, not a full ORM.
- SQLite, MySQL, and PostgreSQL are supported via `bun:sql`. Further DB adapters are out of scope until there is concrete runtime need.
- Lightweight init wizard and no admin UI yet.

## Release & Validation

You MUST validate your changes using the full CI pipeline before any release or commit that could trigger one.
Do NOT manually run `check`, `test`, or `build` alone. You MUST run:
```bash
bun run validate
```
This guarantees local parity with the GitHub Actions CI pipeline and prevents broken code from being pushed.

Release steps:
1. Update `VERSION` file.
2. Run `bun run release:prep` (syncs versions + generates changelog).
3. Commit with Conventional Commits: `chore(release): bump version to X.Y.Z` (crucial for changelog tool).
4. Push via PR to `main` (CI/CD handles NPM and GitHub release). Do NOT manually create npm packages or GitHub releases.

## Safe-Change Checklist & Mistakes to Avoid

- Does the change preserve the slim runtime model and keep the parent app integration simple?
- Did you avoid tracking build artifacts or local DB files (`*.db`, `dist/`, `*.tgz`)?
- Does it avoid package sprawl or speculative abstractions before there is concrete runtime need?
- Are commits written in Conventional Commit format (`feat:`, `fix:`, etc.)?
- Do not document behavior that no longer exists.
