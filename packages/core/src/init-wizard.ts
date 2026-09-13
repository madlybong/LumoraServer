import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

export interface InitAnswers {
  projectName: string;
  base: string;
  version: string;
  mode: "development" | "production";
  auth: "disabled" | "static" | "jwt";
  database: "sqlite" | "mysql";
  routesDir: string;
  docs: boolean;
  realtime: boolean;
  agentic: boolean;
}

export async function detectExistingBunApp(targetDir: string): Promise<boolean> {
  try {
    const info = await stat(path.join(targetDir, "package.json"));
    return info.isFile();
  } catch {
    return false;
  }
}

export async function runInitWizard(targetDir = process.cwd()): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const existing = await detectExistingBunApp(targetDir);

  const projectName = (await rl.question(`Project name (${path.basename(targetDir)}): `)) || path.basename(targetDir);
  const base = (await rl.question("API base path (/api): ")) || "/api";
  const version = (await rl.question("API version (v1): ")) || "v1";
  const mode = ((await rl.question("Default mode (development/production): ")) || "development") as InitAnswers["mode"];
  const auth = ((await rl.question("Auth mode (disabled/static/jwt): ")) || "disabled") as InitAnswers["auth"];
  const database = ((await rl.question("Database (sqlite/mysql): ")) || "sqlite") as InitAnswers["database"];
  
  const agentic = ((await rl.question("Use recommended AI-agentic project structure? (Y/n): ")) || "y").toLowerCase() !== "n";
  const defaultRoutesDir = agentic ? "src/resources" : "routes";
  const routesDir = (await rl.question(`Resource directory (${defaultRoutesDir}): `)) || defaultRoutesDir;
  
  const docs = ((await rl.question("Enable docs in development? (Y/n): ")) || "y").toLowerCase() !== "n";
  const realtime = ((await rl.question("Enable realtime (SSE/WebSocket) endpoints? (y/N): ")) || "n").toLowerCase() === "y";

  const answers: InitAnswers = { projectName, base, version, mode, auth, database, routesDir, docs, realtime, agentic };

  rl.close();
  await scaffoldLumoraProject(targetDir, answers, existing);
  console.log(`Lumora initialized in ${targetDir}`);
}

export async function scaffoldLumoraProject(targetDir: string, answers: InitAnswers, existingApp: boolean): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await mkdir(path.join(targetDir, answers.routesDir), { recursive: true });
  await mkdir(path.join(targetDir, "src"), { recursive: true });
  await mkdir(path.join(targetDir, "migrations"), { recursive: true });
  if (answers.agentic) {
    await mkdir(path.join(targetDir, "src", "routes"), { recursive: true });
    await mkdir(path.join(targetDir, "src", "services"), { recursive: true });
    await mkdir(path.join(targetDir, "tests"), { recursive: true });
  }

  const packageJsonPath = path.join(targetDir, "package.json");
  const currentPackage = existingApp ? JSON.parse(await readFile(packageJsonPath, "utf8")) : { name: answers.projectName, version: "0.1.0", scripts: {} };

  currentPackage.name ??= answers.projectName;
  currentPackage.private ??= true;
  currentPackage.type ??= "module";
  currentPackage.dependencies = {
    ...(currentPackage.dependencies ?? {}),
    "@astrake/lumora-server": "latest"
  };
  currentPackage.scripts = {
    ...(currentPackage.scripts ?? {}),
    "dev:lumora": "bun run src/index.ts"
  };

  const authSnippet =
    answers.auth === "disabled"
      ? `{ mode: "disabled" }`
      : answers.auth === "static"
        ? `{ mode: "static", token: process.env.LUMORA_STATIC_TOKEN ?? "change-me" }`
        : `{ mode: "jwt", secret: process.env.LUMORA_JWT_SECRET ?? "change-me" }`;

  const dbSnippet =
    answers.database === "sqlite"
      ? `{ client: "sqlite", url: "sqlite://./lumora.db" }`
      : `{ client: "mysql", url: process.env.DATABASE_URL ?? "mysql://root:password@localhost:3306/${answers.projectName}" }`;

  await writeFile(
    packageJsonPath,
    `${JSON.stringify(currentPackage, null, 2)}\n`
  );
  await writeFile(
    path.join(targetDir, "lumora.config.ts"),
    `import { defineLumoraConfig } from "@astrake/lumora-server";

export default defineLumoraConfig({
  name: ${JSON.stringify(answers.projectName)},
  mode: ${JSON.stringify(answers.mode)},
  api: {
    base: ${JSON.stringify(answers.base)},
    version: ${JSON.stringify(answers.version)}
  },
  auth: ${authSnippet},
  database: ${dbSnippet},
  routes: {
    dir: ${JSON.stringify(answers.routesDir)}
  },
  // Migration files: migrations/YYYYMMDD_NNN_description.sql
  // dev  \u2192 applied automatically on startup
  // prod \u2192 run \`bun run lumora migrate\` before deploying
  migrations: {
    dir: "./migrations"
  },
  docs: {
    enabled: ${answers.docs ? "true" : "false"}
  }${answers.realtime ? ",\n  realtime: {\n    enabled: true\n  }" : ""}
});
`
  );
  await writeFile(
    path.join(targetDir, answers.routesDir, "company.ts"),
    `import { defineResource } from "@astrake/lumora-server";

export default defineResource({
  resource: "company",
  fields: {
    name: { type: "string", required: true, filterable: true, sortable: true },
    domain: { type: "string", filterable: true, sortable: true },
    active: { type: "boolean", default: true, filterable: true }
  },
  query: {
    defaultPageSize: 20,
    maxPageSize: 100
  }
});
`
  );
  await writeFile(
    path.join(targetDir, "src", "index.ts"),
    `import { initLumora } from "@astrake/lumora-server";

const lumora = await initLumora("./lumora.config.ts");

const server = Bun.serve({
  port: lumora.config.server.port,
  fetch: lumora.fetch,
  websocket: lumora.websocket
});

console.log(\`Lumora listening on http://localhost:\${server.port}\`);
`
  );
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  await writeFile(
    path.join(targetDir, "migrations", `${today}_001_initial_schema.sql`),
    `-- Migration: ${today}_001_initial_schema
-- Initial schema for ${answers.projectName}.
-- Add future structural changes in new numbered files:
--   ${today}_002_add_column.sql

-- Example: uncomment and adapt the table below to your first resource
-- CREATE TABLE IF NOT EXISTS \`company\` (
--   \`id\`         VARCHAR(191) PRIMARY KEY,
--   \`name\`       TEXT NOT NULL,
--   \`created_at\` TEXT NOT NULL,
--   \`updated_at\` TEXT NOT NULL
-- );
`
  );
  const cursorRulesContent = answers.agentic
    ? `# Lumora Agentic Recommended Structure
1. Always ask the user if they want to follow the 'Lumora Recommended Agentic Structure' before generating new domains.
2. Strictly use \`src/resources/\` for declarative schemas (using defineResource).
3. Use \`src/routes/\` for imperative Hono endpoints.
4. Use \`src/services/\` for business logic and integrations.
5. Place tests in the \`tests/\` directory and use \`bun test\`.
`
    : `# Lumora Custom Structure
1. Always ask the user if they want to follow the 'Lumora Recommended Agentic Structure' before generating new domains. If they decline, adapt to their custom directory structure.
2. The user has opted for a simpler structure. Place resources in \`${answers.routesDir}/\`.
`;

  await writeFile(path.join(targetDir, ".cursorrules"), cursorRulesContent);
  await writeFile(path.join(targetDir, "llms.txt"), cursorRulesContent);

  await writeFile(
    path.join(targetDir, "LUMORA_SETUP.md"),
    `# Lumora Setup

- Config file: \`lumora.config.ts\`
- Resource directory: \`${answers.routesDir}\`
- Migrations directory: \`migrations/\`
- Dev command: \`bun run dev:lumora\`
- Generated REST path: ${answers.base}/${answers.version}/company
${answers.realtime
    ? `- Realtime endpoints:\n  - SSE: ${answers.base}/${answers.version}/company/events\n  - WebSocket: ${answers.base}/${answers.version}/company/ws`
    : `- Realtime endpoints: disabled (add \`realtime: { enabled: true }\` to config to enable)`}

## Migrations

Add SQL files to \`migrations/\` using this naming convention:

  YYYYMMDD_NNN_description.sql

Development: migrations apply automatically on \`bun run dev:lumora\`.
Production:  run \`bun run lumora migrate\` before starting the server.
Status:      \`bun run lumora migrate --status\`
`
  );
}
