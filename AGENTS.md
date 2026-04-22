# Lumora Agent Guide

This is the short operating guide for AI coding agents working in this repository.

## Mission

Lumora is a slim framework, not a plugin-heavy platform. Keep the repo aligned with this model:

- one published package: `@astrake/lumora`
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
  Reference Bun app showing how a parent application consumes Lumora.
- `tools`
  Repo-level typecheck and build scripts.

## Working rules

- Keep the public API small: `defineLumoraConfig`, `defineResource`, `initLumora`.
- Prefer extending the existing runtime over reintroducing old package sprawl.
- Do not rebuild the removed plugin/container/jobs architecture.
- Keep resource files schema-first.
- Keep auth behavior simple:
  dev can disable auth
  production must require auth
- Keep generated REST, SSE, WebSocket, docs, and event emission aligned as one runtime story.

## Preferred implementation pattern

1. Update shared types in `packages/core/src/types.ts` if the public contract changes.
2. Update runtime behavior in `packages/core/src/runtime.ts` and nearby modules.
3. Demonstrate usage in `apps/starter`.
4. Add or update tests.
5. Update docs in the same change.

## What "done" looks like

- `bun run check` passes
- `bun test` passes
- `bun run build` passes
- docs match the cleaned repo and current runtime behavior

## Common mistakes to avoid

- Reintroducing removed package sprawl
- Documenting behavior that no longer exists
- Tracking build artifacts or local DB files
- Adding large abstractions before there is a concrete runtime need
