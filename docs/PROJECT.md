# Project Overview — `@astrake/lumora-server`

## What Lumora Server is

Lumora is a slim Bun + Hono framework for parent applications that want:

- typed `lumora.config.ts`
- file-based resource definitions in `routes/*.ts`
- generated CRUD REST endpoints
- generated SSE and WebSocket endpoints
- server-side lifecycle and DB transaction events
- automatic dev-mode OpenAPI and docs UI

The framework is intentionally smaller than the earlier scaffold. It no longer centers on plugins, workers, or a broad multi-package platform story.

## Product direction

Lumora is aiming for a clean developer experience:

1. run `bunx init @astrake/lumora-server`
2. answer setup questions
3. get `lumora.config.ts`, starter route files, and a working Bun app
4. add resource files and let Lumora generate API surfaces

## Current repo shape

- `packages/core`
  The published framework package `@astrake/lumora-server`
- `apps/starter`
  The reference Bun application
- `tools`
  Build and typecheck helpers

There are no other active framework packages in the repo anymore.

## What the framework exposes today

- `defineLumoraConfig(...)`
- `defineResource(...)`
- `initLumora(configOrPath)`
- generated CRUD for DB-backed resources
- SSE and WebSocket endpoints per resource
- typed event emitter for lifecycle, CRUD, DB transaction, and realtime message events
- static token and JWT auth modes
- dev-mode OpenAPI JSON and simple docs UI
- interactive init wizard

## What the starter app proves

The starter app demonstrates the intended parent-app usage model:

- the app owns `lumora.config.ts`
- the app defines resources in `routes/*.ts`
- the app calls `initLumora(...)`
- Bun serves the returned `fetch` and `websocket` handlers

If a feature cannot be explained through that model, it likely does not fit the current framework direction yet.

## Current limitations

- the CRUD engine is intentionally simple and schema-first
- first-class DB support is limited to SQLite and MySQL paths
- docs UI is intentionally lightweight
- Administrator UI is not implemented yet
- the init wizard is functional but still early compared to a polished published DX
