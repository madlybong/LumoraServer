# Lumora Server - Database Layer Rule Catalog

## DB Engine Rules

| ID | Rule |
|---|---|
| D1 | **Three-Client Model** | Lumora supports exactly three DB clients: `sqlite`, `mysql`, `postgresql`. Adding a fourth adapter requires a new LUR and explicit approval. |
| D2 | **Dialect Seam** | All dialect-specific SQL (DDL types, identifier quoting, parameter placeholders) MUST be contained in `packages/core/src/db.ts`. No raw SQL dialect choices belong in `runtime.ts`, `migrations.ts`, or resource files. |
| D3 | **No ORM** | Do not introduce query builder or ORM packages. The parameterised query approach using `bun:sql` / `bun:postgres` tagged templates is sufficient. |
| D4 | **Schema Isolation** | For PostgreSQL, `search_path` is set per-connection via `onconnect` hook. Dynamic per-request schema switching is NOT supported and must not be added without a new LUR. |
| D5 | **Backward Compatibility** | Every change to `LumoraDatabase` public methods must leave SQLite and MySQL behavior identical to the last stable release. |
