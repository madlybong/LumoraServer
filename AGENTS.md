# Lumora Agent Guide — `@astrake/lumora-server`

This is the short operating guide for AI coding agents working in this repository.

## Mission

`@astrake/lumora-server` is a slim framework, not a plugin-heavy platform. Keep the repo aligned with this model:

- one published package: `@astrake/lumora-server`
- one reference app: `apps/starter`
- one main workflow: typed config + file-based resources + generated runtime

## First places to read

- `README.md`
- `docs/PROJECT.md`
- `docs/ARCHITECTURE.md`
- `packages/core/src/types.ts`
- `packages/core/src/runtime.ts`
- `apps/starter/lumora.config.ts`
- `apps/starter/routes/company.ts`

## Repo map

- `packages/core`
  Published framework package. Owns typed config, init wizard, runtime, auth, DB CRUD engine, realtime, docs, and event emitter.
- `apps/starter`
  Reference Bun app showing how a parent application consumes Lumora Server.
- `tools`
  Repo-level typecheck, build, version sync, and changelog scripts.
- `.github/workflows`
  `ci.yml`, `release.yml`, `version-check.yml`, `codeql.yml`

## Working rules

- Keep the public API small: `defineLumoraConfig`, `defineResource`, `initLumora`.
- Prefer extending the existing runtime over reintroducing old package sprawl.
- Do not rebuild the removed plugin/container/jobs architecture.
- Keep resource files schema-first.
- Keep auth behavior simple:
  - dev can disable auth
  - production must require auth
- Keep generated REST, SSE, WebSocket, docs, and event emission aligned as one runtime story.
- Use conventional commits — `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, etc. — so the changelog tool works correctly.

## Preferred implementation pattern

1. Update shared types in `packages/core/src/types.ts` if the public contract changes.
2. Update runtime behavior in `packages/core/src/runtime.ts` and nearby modules.
3. Demonstrate usage in `apps/starter`.
4. Add or update tests.
5. Update docs in the same change.

## Release workflow

To release a new version:

1. Update `VERSION` file.
2. Run `bun run release:prep` (syncs versions + generates changelog).
3. Commit: `git commit -am "chore(release): bump version to X.Y.Z"`.
4. Push to `main` — the release workflow fires automatically.

Do **not** manually create npm packages or GitHub releases — automation handles this.

## Badge system

The README uses live badges from:
- `https://github.com/madlybong/LumoraServer/actions/workflows/ci.yml/badge.svg`
- `https://img.shields.io/npm/v/@astrake/lumora-server.svg`

These resolve once the repo is pushed to GitHub and the first CI run completes.

## What "done" looks like

- `bun run check` passes
- `bun test` passes
- `bun run build` passes
- docs match the cleaned repo and current runtime behavior
- `bun run version:check` produces a clean `git diff`

## Common mistakes to avoid

- Reintroducing removed package sprawl
- Documenting behavior that no longer exists
- Tracking build artifacts or local DB files (`*.db`, `dist/`, `*.tgz`)
- Adding large abstractions before there is a concrete runtime need
- Writing non-conventional commits that break changelog grouping
