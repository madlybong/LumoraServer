# Development Workflow — `@astrake/lumora-server`

## Local setup

```bash
bun install
bun run check
bun test
```

## Main commands

Start the reference app:

```bash
bun run dev
```

Run the local init wizard:

```bash
bun run cli
```

Build the active projects:

```bash
bun run build
```

Sync versions from `VERSION`:

```bash
bun run version:sync
```

Generate a changelog entry for the current version:

```bash
bun run changelog
```

Prepare a release (sync + changelog in one step):

```bash
bun run release:prep
```

## Repo conventions

- TypeScript only
- Bun workspace with two active projects:
  - `packages/core`
  - `apps/starter`
- root `tools/` scripts orchestrate check and build

## Starter app workflow

The starter app is the reference parent application. It should continue to demonstrate:

- `lumora.config.ts`
- `routes/*.ts`
- `initLumora(...)`
- Bun `fetch` + `websocket` serving

## Coding conventions

- Keep public types explicit.
- Keep the framework surface small.
- Prefer extending the existing runtime over introducing new package boundaries.
- Keep resource DSL features practical and schema-first.
- Update tests and docs in the same change when the runtime contract changes.

## Adding a framework feature

1. Update shared types.
2. Update runtime behavior.
3. Add or adjust starter usage.
4. Add tests.
5. Update docs.

## Verification rule

Before closing work, run:

```bash
bun run check
bun test
bun run build
```

## Documentation rule

Any change to the public runtime, resource DSL, auth behavior, docs generation, or init wizard should update the relevant docs in the same change.
