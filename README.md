# Lumora

Lumora is a slim Bun + Hono framework for building typed, file-based APIs with generated CRUD, SSE, WebSocket messaging, typed config, and an init wizard.

The framework centers on three things:

- `bunx init @astrake/lumora`
- `lumora.config.ts`
- `routes/*.ts`

## Documentation

- [Project Overview](./docs/PROJECT.md)
- [Architecture Guide](./docs/ARCHITECTURE.md)
- [AI Agent Guide](./docs/AI_AGENT_GUIDE.md)
- [Development Workflow](./docs/DEVELOPMENT.md)
- [Release Workflow](./docs/RELEASES.md)
- [Roadmap](./docs/ROADMAP.md)

## Repo Shape

- `packages/core`
  Published package `@astrake/lumora`
- `apps/starter`
  Reference Bun app using typed config and file-based resources
- `tools`
  Cross-package `check` and `build` helpers

## Core API

- `defineLumoraConfig(...)`
- `defineResource(...)`
- `initLumora(configOrPath)`

## Generated Runtime Features

- REST endpoints at `/{base}/{version}/{resource}`
- SSE stream at `/{base}/{version}/{resource}/events`
- WebSocket endpoint at `/{base}/{version}/{resource}/ws`
- dev-mode OpenAPI JSON and docs UI
- typed lifecycle, resource, and DB transaction events

## Quick start

```bash
bun install
bun run check
bun test
bun run dev
```

For local init wizard testing:

```bash
bun run cli
```

The intended published onboarding command is:

```bash
bunx init @astrake/lumora
```

## Automation

- Git repository initialized on `main`
- CI workflow for install, sync, check, test, and build
- release workflow for tagged publishes and package artifacts
- centralized version source in [`VERSION`](./VERSION)
