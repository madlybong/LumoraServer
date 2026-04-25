# AI Agent Guide

## Purpose

This document helps coding agents make aligned changes without re-deriving the current framework direction.

## High-confidence facts

- The active workspace is intentionally small.
- The only active framework package is `packages/core`, published as `@astrake/lumora-server`.
- The only active example app is `apps/starter`.
- The framework is config-first and resource-first.
- The framework is no longer plugin-centric and no longer includes built-in jobs/workers as a main concept.

## Architectural intent

Optimize for:

- a small public API
- typed config and resource contracts
- generated REST + realtime behavior from file-based resources
- minimal framework ceremony for the parent app
- docs that match reality immediately after code changes

## Where changes should go

- Shared framework behavior belongs in `packages/core/src`.
- Parent-app examples belong in `apps/starter`.
- Build and verification workflow belongs in `tools`.
- Documentation changes belong in `README.md`, `AGENTS.md`, and `docs/*`.

## Change heuristics

- If a capability changes the public framework surface, update `types.ts` first.
- If a capability changes routing or runtime behavior, update `runtime.ts` and its tests.
- If a capability is only an example of usage, put it in the starter app.
- If a capability would force several new packages or abstractions, pause and question whether it violates the current slim direction.

## Safe extension patterns

### Adding a resource capability

1. Extend resource types.
2. Update generated runtime behavior.
3. Add or update a starter resource example.
4. Add tests.
5. Update docs.

### Adding auth or docs behavior

1. Extend config types and validation.
2. Update runtime behavior.
3. Verify starter behavior still makes sense.
4. Update docs and tests together.

### Adding DB behavior

1. Keep the adapter seam in `db.ts`.
2. Prefer concrete support for the current DB story over abstract generic layers.
3. Preserve transaction event emission semantics.

## Known current limitations

- the docs UI is intentionally basic
- the CRUD engine is intentionally schema-first and not ORM-like
- DB support is intentionally narrow
- the init wizard is practical but still lightweight
- Administrator UI is only a future extension point right now

## Safe-change checklist

- Does the change preserve the slim runtime model?
- Does the change keep the parent app integration simple?
- Does the change keep docs, tests, and starter app aligned?
- Did you avoid reintroducing removed package sprawl?

## Validation commands

```bash
bun run check
bun test
bun run build
```

For local runtime checks:

```bash
bun run dev
bun run cli
```
