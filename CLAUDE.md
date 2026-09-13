# Claude Code Instructions

## Build & Test Commands
- **Typecheck**: `bun run check` (Must pass before committing)
- **Test**: `bun test`
- **Build**: `bun run build`

## Architectural Guidelines
- **Slim Framework**: Do not add heavy plugins or abstraction layers.
- **Three-Client Parity**: Always ensure SQLite, MySQL, and PostgreSQL are supported equally. Keep DB-specific logic inside `packages/core/src/db.ts`.
- **Config & Resources**: Emphasize typed `lumora.config.ts` and file-based `routes/*.ts`.

## Code Style
- **TypeScript**: Strict mode. Never use `as any` to bypass type errors.
- **Commit Style**: Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).

## Release Flow
- Do not manually publish.
- Update `VERSION`, run `bun run release:prep`, and commit `chore(release): bump version to X.Y.Z`.
