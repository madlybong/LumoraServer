# @astrake/lumora-server

[![CI](https://github.com/madlybong/LumoraServer/actions/workflows/ci.yml/badge.svg)](https://github.com/madlybong/LumoraServer/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@astrake/lumora-server.svg?style=flat)](https://www.npmjs.com/package/@astrake/lumora-server)
[![npm downloads](https://img.shields.io/npm/dm/@astrake/lumora-server.svg?style=flat)](https://www.npmjs.com/package/@astrake/lumora-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun_1.3-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)

> Slim **Bun + Hono** framework — typed config, file-based resources, auto-generated
> REST / SSE / WebSocket endpoints, JWT auth, SQLite, and an interactive init wizard.

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

- **REST endpoints** — `GET / POST / PUT / DELETE /{base}/{version}/{resource}[/:id]`
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

```ts
// lumora.config.ts
import { defineLumoraConfig } from "@astrake/lumora-server";

export default defineLumoraConfig({
  base: "/api",
  version: "v1",
  db: { type: "sqlite", path: "./app.db" },
  auth: { type: "jwt", secret: process.env.JWT_SECRET! },
  routes: "./routes",
});
```

```ts
// routes/users.ts
import { defineResource } from "@astrake/lumora-server";

export default defineResource({
  name: "users",
  schema: {
    name: { type: "string", required: true },
    email: { type: "string", required: true },
  },
});
```

```ts
// src/index.ts
import { initLumora } from "@astrake/lumora-server";

const app = await initLumora("./lumora.config.ts");
app.listen(3000);
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
| Docs | Auto-generated OpenAPI 3.1.0 |

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
- [AI Agent Guide](./docs/AI_AGENT_GUIDE.md)
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
