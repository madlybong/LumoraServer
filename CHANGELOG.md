# Changelog

## Unreleased

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
