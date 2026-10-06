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

## Procedural Endpoints (v0.8.9+)
- Always use `mountModule(path, router, { protected: true, roles: ["admin"], audit: true, rateLimit: true })` for procedural APIs.
- Use `validate` middleware to parse body/query payloads. Read parsed values from `c.var.valid`.
- Return responses using `c.var.ok()`, `c.var.list()`, `c.var.created()`, and `c.var.fail()`.
- Use `LumoraHttpError` for throwing expected HTTP errors.
- Wrap lists in `ctx.db.page()` to respect `maxRows`.
