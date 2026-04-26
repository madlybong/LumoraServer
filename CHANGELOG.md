# Changelog

## Unreleased

---

## [0.1.6] — 2026-04-26

### Added

- release 0.1.6 with permission hooks, audit trail, email and ai plugins (`c4b6112`)


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
