# Lumora Agentic Recommended Structure

When building applications with `@astrake/lumora-server`, we recommend adopting the "Agentic Architecture". This structure explicitly separates declarative schemas from imperative logic, which is crucial for maintaining a clean codebase and ensuring that AI coding assistants (like Cursor, Copilot, or Claude) can effectively understand and extend your project without hallucinations.

## Directory Structure

```text
my-lumora-backend/
├── .env                  # Secrets and environment-specific variables
├── .env.example          # Template for environment variables
├── .cursorrules          # (AI CONTEXT) Native instructions for Cursor/LLMs on Lumora standards
├── llms.txt              # (AI CONTEXT) Context file for AI web-crawlers/agents
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config (strict mode enabled by default)
├── lumora.config.ts      # Core Lumora config (database, api base, auth)
├── migrations/           # Raw SQL migration files managed by Lumora
│   └── 20260913_001_init.sql
├── src/
│   ├── index.ts          # Entry point (bootstraps initLumora and Bun.serve)
│   ├── resources/        # (DECLARATIVE) Lumora resources (tables, fields, hooks)
│   │   ├── users.ts      
│   │   └── posts.ts      
│   ├── routes/           # (IMPERATIVE) Custom Hono API routes (webhooks, custom auth)
│   │   └── webhooks.ts
│   ├── services/         # (LOGIC) Business logic layer, external integrations (Stripe, AI)
│   │   └── email.ts
│   └── utils/            # (HELPERS) Shared utility functions
└── tests/                # Integration and Unit tests (using bun test)
    └── app.test.ts
```

## Core Concepts

### 1. Separation of Resources vs. Routes
- **`src/resources/`**: Exclusively for `defineResource()` definitions. These map 1:1 with database tables and automatically generate REST, SSE, and WebSocket endpoints. AI agents know that files here are purely declarative.
- **`src/routes/`**: Exclusively for standard Hono route definitions (e.g., Stripe webhooks, complex multi-step OAuth, file proxying). Users attach these directly to the Hono instance (`lumora.app.route(...)`) in `src/index.ts`. AI agents know that files here are imperative logic.

### 2. Services Layer
Business logic should not be tightly coupled to Lumora resource hooks. If a resource hook (`afterInsert`) needs to send a welcome email, it should call `emailService.sendWelcome()` from the `src/services/` directory. This keeps schemas clean and logic highly testable.

### 3. AI Native Constraints
When you initialize a project using `bunx @astrake/lumora-server init`, if you opt-in to the Agentic structure, Lumora automatically generates `.cursorrules` and `llms.txt` files. These files instruct any AI assistant working in your repository to strictly adhere to these directory boundaries, drastically improving code generation quality.
