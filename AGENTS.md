# Lumora Agent Guide — `@astrake/lumora-server`

This is the short operating guide for AI coding agents working in this repository.

## Mission & Architecture

`@astrake/lumora-server` is a slim framework, not a plugin-heavy platform. Keep the repo aligned with this model:
- One published package: `@astrake/lumora-server`
- One reference app: `apps/starter`
- One main workflow: typed config + file-based resources + generated runtime

Keep the public API small (`defineLumoraConfig`, `defineResource`, `initLumora`). Prefer extending the existing runtime over reintroducing old package sprawl or removed plugin/container/jobs architecture. Keep resource files schema-first.

## First Places to Read & Change Heuristics

- `packages/core` (published framework package: typed config, runtime, auth, DB CRUD engine, realtime, docs)
- `apps/starter` (reference Bun app showing config, routes, resources)
- Docs: `README.md`, `docs/PROJECT.md`, `docs/ARCHITECTURE.md`

**Change Pattern:**
1. If a change impacts the public framework surface, update shared types in `packages/core/src/types.ts` first.
2. Update runtime/routing in `packages/core/src/runtime.ts` or adjacent modules.
3. Demonstrate usage in `apps/starter`.
4. Add or update tests, then update docs.

## Safe Extension Heuristics

- **Resource Capabilities:** Extend resource types -> update generated runtime -> add starter example -> add tests -> update docs.
- **Auth/Docs Behavior:** Extend config types & validation -> update runtime -> verify starter -> update docs & tests. Dev can disable auth; production MUST require it.
- **DB Adapter/Engine:** Keep the adapter seam in `db.ts`. Prefer concrete SQLite/MySQL/PostgreSQL support over abstract ORMs. Keep transaction event emission semantics.

## Known Limitations (Do Not Over-Engineer)

- Basic Docs UI is intentionally simple.
- CRUD engine is schema-first, not a full ORM.
- SQLite, MySQL, and PostgreSQL are supported via `bun:sql`/`bun:postgres`. Further DB adapters are out of scope until there is concrete runtime need.
- Lightweight init wizard and no admin UI yet.

## Release & Validation

Validate with:
```bash
bun run check
bun test
bun run build
bun run version:check
```

Release steps:
1. Update `VERSION` file.
2. Run `bun run release:prep` (syncs versions + generates changelog).
3. Commit with Conventional Commits: `chore(release): bump version to X.Y.Z` (crucial for changelog tool).
4. Push to `main` (CI/CD handles NPM and GitHub release). Do NOT manually create npm packages or GitHub releases.

## Safe-Change Checklist & Mistakes to Avoid

- Does the change preserve the slim runtime model and keep the parent app integration simple?
- Did you avoid tracking build artifacts or local DB files (`*.db`, `dist/`, `*.tgz`)?
- Does it avoid package sprawl or speculative abstractions before there is concrete runtime need?
- Are commits written in Conventional Commit format (`feat:`, `fix:`, etc.)?
- Do not document behavior that no longer exists.

