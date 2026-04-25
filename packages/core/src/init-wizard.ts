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

  const answers: InitAnswers = {
    projectName: (await rl.question(`Project name (${path.basename(targetDir)}): `)) || path.basename(targetDir),
    base: (await rl.question("API base path (/api): ")) || "/api",
    version: (await rl.question("API version (v1): ")) || "v1",
    mode: ((await rl.question("Default mode (development/production): ")) || "development") as InitAnswers["mode"],
    auth: ((await rl.question("Auth mode (disabled/static/jwt): ")) || "disabled") as InitAnswers["auth"],
    database: ((await rl.question("Database (sqlite/mysql): ")) || "sqlite") as InitAnswers["database"],
    routesDir: (await rl.question("Routes directory (routes): ")) || "routes",
    docs: ((await rl.question("Enable docs in development? (y/n): ")) || "y").toLowerCase() !== "n"
  };

  rl.close();
  await scaffoldLumoraProject(targetDir, answers, existing);
  console.log(`Lumora initialized in ${targetDir}`);
}

export async function scaffoldLumoraProject(targetDir: string, answers: InitAnswers, existingApp: boolean): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await mkdir(path.join(targetDir, answers.routesDir), { recursive: true });
  await mkdir(path.join(targetDir, "src"), { recursive: true });

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
  docs: {
    enabled: ${answers.docs ? "true" : "false"}
  }
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
  await writeFile(
    path.join(targetDir, "LUMORA_SETUP.md"),
    `# Lumora Setup

- Config file: \`lumora.config.ts\`
- Resource directory: \`${answers.routesDir}\`
- Dev command: \`bun run dev:lumora\`
- Generated REST path: ${answers.base}/${answers.version}/company
- Realtime endpoints:
  - SSE: ${answers.base}/${answers.version}/company/events
  - WebSocket: ${answers.base}/${answers.version}/company/ws
`
  );
}
