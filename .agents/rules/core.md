# Lumora Server - Core Package Rule Catalog

This catalog defines the strict coding rules and architecture requirements for developers working inside `packages/core`.

## Global Hard Rules (Non-Negotiable)

| ID | Rule | Violation |
|---|---|---|
| C1 | **Types-First Principle** | Any changes to public-facing API capabilities or configurations MUST define or update their respective TypeScript definitions in `packages/core/src/types.ts` first. |
| C2 | **Public API Freeze** | The public API exported from `src/index.ts` is strictly frozen to `defineLumoraConfig`, `defineResource`, and `initLumora`. Do NOT export internal routers, query utilities, or helper classes. |
| C3 | **No Heavy Abstractions** | Avoid speculative wrappers or ORMs. Databases are supported directly via SQLite (`bun:sql` and `bun:postgres`) and MySQL. Do not add complex dynamic query generator patterns. The three-client branching pattern inside `db.ts` is the correct, approved extension model. |
| C5 | **DB Dialect Seam** | PostgreSQL is the third supported client alongside SQLite and MySQL. All dialect-specific SQL MUST be contained inside `db.ts`. |
| C4 | **No Queue Subsystems** | Do NOT add background workers, jobs, cron schedules, or event loop blocking queues. Keep the framework in-process and lightweight. |

## Core Implementation Block Checklist

When writing or modifying framework components, ensure the following is respected:

- [ ] **Auth Enforcement**: In production configurations, authentication is mandatory. Ensure `resolveLumoraConfig` rejects non-test/non-dev runs that attempt to disable auth.
- [ ] **Event Semantic Safety**: When database transaction routes execute, corresponding transaction event hooks (`db:transaction:before/after/rollback`) and resource lifecycle hooks (`resource:create/update/delete`) MUST be emitted cleanly.
- [ ] **Bun Native Tools**: Rely strictly on Bun standard libraries (`bun:sql`, `Bun.password`, native testing). Do not pull external heavy npm packages.
