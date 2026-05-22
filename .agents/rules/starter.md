# Lumora Server - Reference App Rule Catalog

This catalog defines rules for modifying the starter reference application under `apps/starter`.

## Reference Design Hard Rules

| ID | Rule | Violation |
|---|---|---|
| R1 | **Demonstrate-Only Scope** | Do NOT write heavy business logic, payment integrations, or proprietary custom security flows inside `apps/starter`. It is a framework demo tool only. |
| R2 | **Git Ignored DB Safety** | SQLite database files (e.g. `dev.db`, `lumora.db`, `*.db-wal`, `*.db-shm`) and local credential logs must never be committed. |
| R3 | **Framework Sourced** | Use `@astrake/lumora-server` directly as the engine. Do not build custom routes that bypass Hono middleware or duplicate CRUD functionality. |

## 'defineResource()' Required Block Checklist

Every mock resource file under `apps/starter/resources/` must declare:
- `auth`: `{ mode: "protected" }` (or `disabled` explicitly in developer settings)
- `audit`: `true` (if tracking mutations)
- `schema`: `{ fields: { ... } }`
- `permissions`: `{ roles: { ... } }`
