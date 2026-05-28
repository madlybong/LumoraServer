# Lumora Server - Database Layer Rule Catalog

## DB Engine Rules

| ID | Rule |
|---|---|
| D1 | **Three-Client Model** | Lumora supports exactly three DB clients: `sqlite`, `mysql`, `postgresql`. Adding a fourth adapter requires a new LUR and explicit approval. |
| D2 | **Dialect Seam** | All dialect-specific SQL (DDL types, identifier quoting, parameter placeholders) MUST be contained in `packages/core/src/db.ts`. No raw SQL dialect choices belong in `runtime.ts`, `migrations.ts`, or resource files. |
| D3 | **No ORM** | Do not introduce query builder or ORM packages. The parameterised query approach using `bun:sql` / `bun:postgres` tagged templates is sufficient. |
| D4 | **Schema Isolation** | For PostgreSQL, `search_path` is set via the `connection: { search_path: schema }` startup parameter in the `SQL` constructor options. The `onconnect` hook is NOT used for this — it only receives `(err: Error | null)` and cannot run queries. |
| D5 | **Backward Compatibility** | Every change to `LumoraDatabase` public methods must leave SQLite and MySQL behavior identical to the last stable release. |
| D6 | **Read `bun-types` Before Writing Native API Code** | Before writing any code that calls `new SQL(...)` or any other `bun:*` API, the agent MUST read the relevant section of `node_modules/bun-types/*.d.ts`. The type signature in `node_modules` is the ground truth. Do not rely on memory, documentation websites, or previous conversation context. |
