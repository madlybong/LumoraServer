# GitHub Copilot Instructions for Lumora Server

## Project Identity
`@astrake/lumora-server` is a slim, lightweight, config-first and resource-first API framework built with Bun and Hono. It generates REST, SSE, WebSockets, docs, and event emission from simple resource schemas.

## Canonical Reference File
Always read and align with the repository's main operating guide:
👉 **[AGENTS.md](file:///c:/xLab/xlab26/lumora/LumoraServer/AGENTS.md)**

## Core Coding Conventions

1. **Keep it Slim:** Prefer simple, lightweight, Hono-based runtime solutions. Do not add heavy abstractions, background job runners, queue systems, or complex plugin wrappers.
2. **Schema-First API:** The framework generates routes and database access patterns automatically from structured resource schemas. Keep it types-first.
3. **Public API Boundaries:** Keep the public framework surface limited to `defineLumoraConfig`, `defineResource`, and `initLumora`. Do not export internal routers, helpers, or database details.
4. **Dev vs. Prod Auth:** Development environments can disable or mock auth for convenience, but production environments MUST require auth.
5. **Git Commit Style:** Always commit with Conventional Commits (e.g., `feat:`, `fix:`, `docs:`, `chore:`).
