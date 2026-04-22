# Architecture Guide

## System shape

Lumora now has one main runtime package and one reference app. The runtime flow is:

1. load and resolve `lumora.config.ts`
2. discover resource files from `routes.dir`
3. initialize DB connectivity
4. create generated REST, SSE, and WebSocket routes for each resource
5. expose the runtime instance to the parent app

The parent app calls `initLumora(...)` and passes the returned `fetch` and `websocket` handlers into `Bun.serve(...)`.

## Core modules

All active framework code lives in `packages/core/src`.

Key modules:

- `types.ts`
  Public config, resource, event, auth, docs, and runtime types.
- `config.ts`
  `defineLumoraConfig`, config loading, resolution, and validation.
- `resource.ts`
  `defineResource` and resource path normalization.
- `runtime.ts`
  Route discovery, CRUD generation, auth checks, realtime routes, and docs routes.
- `db.ts`
  Slim DB-backed CRUD engine and transaction event emission.
- `realtime.ts`
  In-memory publish/subscribe hub for SSE and WebSocket fan-out.
- `auth.ts`
  Static token and JWT resolution.
- `init-wizard.ts`
  Interactive scaffolding for new or existing Bun apps.

## Public API

The intended public surface is small:

- `defineLumoraConfig(...)`
- `defineResource(...)`
- `initLumora(configOrPath)`

The returned runtime instance exposes:

- `app`
- `fetch`
- `websocket`
- `config`
- `events`
- `realtime`
- `docs`
- `close()`

## Resource model

Each `routes/*.ts` file defines a resource schema, not imperative handlers by default.

A resource can define:

- `resource`
- `table`
- `fields`
- `auth`
- `query`
- `hooks`
- `meta`

The runtime uses that schema to generate:

- `GET /{base}/{version}/{resource}`
- `GET /{base}/{version}/{resource}/:id`
- `POST /{base}/{version}/{resource}`
- `PUT /{base}/{version}/{resource}/:id`
- `DELETE /{base}/{version}/{resource}/:id`
- `GET /{base}/{version}/{resource}/events`
- `GET /{base}/{version}/{resource}/ws`

## Auth model

Auth is intentionally environment-sensitive:

- development can use `disabled`
- production must not use `disabled`
- supported production strategies are `static` and `jwt`

Resource auth can override behavior with:

- `inherit`
- `public`
- `protected`

## DB model

The current runtime assumes DB-backed resources. The implementation is intentionally slim:

- SQLite and MySQL config shapes are first-class
- table creation is automatic per discovered resource
- CRUD is generated directly from resource fields
- transactions emit before/after/rollback events

This is not an ORM layer. The resource DSL is smaller and more constrained by design.

## Realtime model

Lumora keeps one resource event model across:

- server-side event emitter
- SSE broadcasts
- WebSocket broadcasts
- generated CRUD side effects

That lets the parent app subscribe once and react consistently across transports.

## Docs model

In development, Lumora can expose:

- an OpenAPI JSON document
- a simple docs UI route

Docs are generated from resolved config and discovered resource definitions. There is no separate docs source of truth.

## Future boundary

Administrator UI is not implemented yet. Current resource metadata and config fields only reserve the extension points needed for future attachment.
