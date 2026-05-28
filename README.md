# @astrake/lumora-server

[![CI](https://github.com/madlybong/LumoraServer/actions/workflows/ci.yml/badge.svg)](https://github.com/madlybong/LumoraServer/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@astrake/lumora-server.svg?style=flat)](https://www.npmjs.com/package/@astrake/lumora-server)
[![npm downloads](https://img.shields.io/npm/dm/@astrake/lumora-server.svg?style=flat)](https://www.npmjs.com/package/@astrake/lumora-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun_1.3-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)

> Slim **Bun + Hono** framework — typed config, file-based resources, auto-generated
> REST / SSE / WebSocket endpoints, JWT auth, SQLite, computed fields, relational joins,
> file uploads, bulk ops, CSV export, scheduled tasks, store-scoped permissions, and a
> built-in multi-provider AI gateway.

**[Documentation](https://server.lumora.astrake.com)** · **[npm](https://www.npmjs.com/package/@astrake/lumora-server)** · **[Changelog](./CHANGELOG.md)** · **[Issues](https://github.com/madlybong/LumoraServer/issues)**

---

## Overview

`@astrake/lumora-server` centers on three primitives:

| Primitive | Purpose |
|-----------|---------|
| `defineLumoraConfig(config)` | Declare and type-check your server configuration |
| `defineResource(schema)` | Define a typed, file-based resource |
| `initLumora(configOrPath)` | Boot the runtime — returns a `LumoraInstance` |

From a single `lumora.config.ts` and a `routes/` folder, Lumora generates:

- **REST endpoints** — `GET / POST / PUT / PATCH / DELETE /{base}/{version}/{resource}[/:id]`
- **Bulk create** — `POST /{base}/{version}/{resource}/bulk`
- **CSV export** — `GET /{base}/{version}/{resource}/export/csv`
- **File upload/serve** — `POST /{base}/{version}/{resource}/:id/files` · `GET /{base}/{version}/{resource}/:id/files/:field`
- **SSE stream** — `GET /{base}/{version}/{resource}/events`
- **WebSocket endpoint** — `GET /{base}/{version}/{resource}/ws`
- **OpenAPI 3.1.0 document** — `GET /__lumora/openapi.json` *(dev mode)*
- **Docs UI** — `GET /__lumora/docs` *(dev mode)*
- **Health check** — `GET /health`

---

## Quick Start

```bash
# Scaffold a new project
bunx init @astrake/lumora-server

# Or install manually
bun add @astrake/lumora-server
```

**Alternatively, clone and run locally:**

```bash
git clone https://github.com/madlybong/LumoraServer.git
cd LumoraServer
bun install
bun run check      # typecheck
bun test           # run test suite
bun run dev        # start the reference starter app
```

---

## Usage

### PostgreSQL Quick-Start

```typescript
import { defineLumoraConfig } from "@astrake/lumora-server";

export default defineLumoraConfig({
  database: {
    client: "postgresql",
    url: "postgres://user:pass@localhost:5432/db"
  }
});
```


```ts
// lumora.config.ts
import { defineLumoraConfig } from "@astrake/lumora-server";

export default defineLumoraConfig({
  base: "/api",
  version: "v1",
  db: { client: "sqlite", url: "./app.db" },
  auth: { type: "jwt", secret: process.env.JWT_SECRET! },
  routes: "./routes",
  ai: {
    providers: { gemini: { apiKey: process.env.GEMINI_API_KEY! } },
    defaultProvider: "gemini",
    tokenTracking: true,
  },
  schedule: [
    { name: "daily-report", cron: "0 8 * * *", handler: async (ctx) => { /* ... */ } },
  ],
});
```

```ts
// routes/products.ts
import { defineResource } from "@astrake/lumora-server";

export default defineResource({
  resource: "products",
  fields: {
    name:     { type: "string",  required: true, searchable: true },
    price:    { type: "number",  required: true, filterable: true },
    image:    { type: "file",   accept: ["image/*"], maxSize: "10MB" },
    category_id: { type: "string", filterable: true },
  },
  computed: {
    display_price: { type: "string", resolve: async (r) => `$${r.price}` },
  },
  relations: {
    category: { resource: "categories", foreignKey: "category_id", type: "belongsTo" },
  },
  permissions: {
    scope: { field: "store_id" },
  },
});
```

```ts
// src/index.ts
import { initLumora } from "@astrake/lumora-server";

const lumora = await initLumora("./lumora.config.ts");

// Realtime broadcast
lumora.realtime.broadcast("products:updated", { id: "123" });

// AI gateway
const result = await lumora.ai.chat({
  messages: [{ role: "user", content: "Describe this product" }],
});

// Structured query (SQL-injection-safe)
const data = await lumora.query.execute(
  { resource: "products", filters: [{ field: "price", operator: "gt", value: 100 }] },
  { auth, database: lumora.database },
);
```

---

## Runtime Stack

| Concern | Technology |
|---------|-----------|
| Runtime | Bun 1.3.12 |
| HTTP framework | Hono 4.9.7 |
| Language | TypeScript 5.9+ |
| Database | SQLite (`bun:sql`) · MySQL (optional) |
| Auth | Static token · HS256 JWT |
| Realtime | In-process SSE + WebSocket pub/sub hub |
| Scheduling | Native `Bun.cron` (declarative DSL, retry, logging) |
| AI Gateway | Gemini · OpenAI · Anthropic · Kilo · custom |
| Docs | Auto-generated OpenAPI 3.1.0 |

---

## Capabilities

| # | Feature | API Surface |
|---|---------|-------------|
| LS-1 | Computed / virtual fields | `computed` in `defineResource()` |
| LS-2 | Relational joins | `relations` + `?include=` param |
| LS-3 | File upload & serving | `file` / `file[]` field types |
| LS-4 | Bulk create (transactional) | `POST /{resource}/bulk` |
| LS-5 | CSV export | `GET /{resource}/export/csv` |
| LS-6 | Namespaced event bus | `resource:{name}:created/updated/deleted` |
| LS-7 | Realtime broadcast | `instance.realtime.broadcast(topic, data)` |
| LS-8 | Declarative scheduler | `schedule: [...]` in config |
| LS-9 | Store-scoped permissions | `permissions.scope` in `defineResource()` |
| LS-10 | AI provider gateway | `instance.ai.chat()`, `getUsage()` |
| LS-11 | Structured query executor | `instance.query.execute(descriptor, ctx)` |
| LS-12 | File-based SQL migrations | `bun run lumora migrate` |

---

## Repo Shape

```
LumoraServer/
├── packages/core/        ← @astrake/lumora-server (published package)
├── apps/starter/         ← reference Bun app
├── tools/                ← build, check, version, changelog scripts
└── docs/                 ← architecture, development, releases, legal
```

---

## Documentation

- [Project Overview](./docs/PROJECT.md)
- [Architecture Guide](./docs/ARCHITECTURE.md)
- [Development Workflow](./docs/DEVELOPMENT.md)
- [Release Workflow](./docs/RELEASES.md)
- [AI Agent Rules](./AGENTS.md)
- [Legal Notice & Disclaimer](./docs/LEGAL.md)
- [Roadmap](./docs/ROADMAP.md)

---

## Automation

| Trigger | Workflow | Effect |
|---------|----------|--------|
| Push to `main` | CI | Install → typecheck → test → build |
| PR with `VERSION` change | Version Check | Ensures VERSION is the single source of truth |
| `VERSION` bump on `main` | Release | Build → changelog → GitHub Release → npm publish |
| Manual tag `v*` | Release | Same as above |
| Every Monday | CodeQL | Security scan |

**Required secrets:** `NPM_TOKEN` — see [docs/RELEASES.md](./docs/RELEASES.md).

---

## Contributing

Contributions are welcome. Please read the working rules in [AGENTS.md](./AGENTS.md) before submitting a PR.
By contributing, you agree your work is licensed under MIT. See [docs/LEGAL.md](./docs/LEGAL.md).

---

## Disclaimer

> `@astrake/lumora-server` is provided **"as is"** without warranty of any kind.
> The author accepts no liability for damages arising from the use of this software.
> See [docs/LEGAL.md](./docs/LEGAL.md) for the full warranty disclaimer and legal notice.

---

## License

[MIT](./LICENSE) © 2026 [Anuvab Chakraborty](https://github.com/madlybong)
