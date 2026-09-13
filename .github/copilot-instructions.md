# GitHub Copilot Instructions for Lumora Server

## Project Identity
`@astrake/lumora-server` is a slim, lightweight, config-first and resource-first API framework built with Bun and Hono. It generates REST, SSE, WebSockets, docs, and event emission from simple resource schemas.

## Canonical Reference File
Always read and align with the repository's main operating guide:
👉 **[AGENTS.md](file:///c:/xLab/xlab26/lumora/LumoraServer/AGENTS.md)**

## Core Coding Conventions

1. **Keep it Slim:** Prefer simple, lightweight, Hono-based runtime solutions. Do not add heavy abstractions, background job runners, queue systems, or complex plugin wrappers.
2. **Schema-First API:** The framework generates routes and database access patterns automatically from structured resource schemas. Keep it types-first. Fields must be top-level under `fields: { ... }`.
3. **Public API Boundaries:** Keep the public framework surface limited to `defineLumoraConfig`, `defineResource`, and `initLumora`. Do not export internal routers, helpers, or database details.
4. **Configuration Shape (v0.8.2):** Expect `api`, `database`, `auth`, `routes`, and `migrations` properties. Never use legacy properties like `db:` or `auth.type:`.
5. **Database Parity:** Features must work across all 3 first-class clients: SQLite (`bun:sqlite`), MySQL, and PostgreSQL (`bun:postgres`).
6. **Realtime Opt-In:** Realtime SSE and WebSocket routes are strictly opt-in via `realtime: { enabled: true }`.
7. **Migrations:** Migrations are file-based plain SQL. Destructive queries (DROP/TRUNCATE) are blocked in production by default (`blockDestructive: true`). SFE binary deploys use `sfe-prep` to embed migrations.
8. **Dev vs. Prod Auth:** Development environments can disable or mock auth for convenience, but production environments MUST require auth.
9. **Git Commit Style:** Always commit with Conventional Commits (e.g., `feat:`, `fix:`, `docs:`, `chore:`).
