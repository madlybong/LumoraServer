import { describe, expect, test } from "bun:test";
import { initLumora, resolveLumoraConfig, defineResource } from "@astrake/lumora-server";
import { readFile } from "node:fs/promises";
import path from "node:path";

function createJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const key = new TextEncoder().encode(secret);
  const signature = new Bun.CryptoHasher("sha256", key).update(data).digest("base64url");
  return `${data}.${signature}`;
}

describe("LP-03 · blockDestructive defaults", () => {
  test("resolveLumoraConfig in production sets blockDestructive=true", () => {
    const config = resolveLumoraConfig(
      {
        name: "test-prod-destructive",
        mode: "production",
        auth: { mode: "static", token: "secret" },
        database: { client: "sqlite", url: ":memory:" }
      },
      process.cwd()
    );
    expect(config.migrations.blockDestructive).toBe(true);
  });

  test("resolveLumoraConfig in development leaves blockDestructive=false", () => {
    const config = resolveLumoraConfig(
      {
        name: "test-dev-destructive",
        mode: "development",
        auth: { mode: "disabled" },
        database: { client: "sqlite", url: ":memory:" }
      },
      process.cwd()
    );
    expect(config.migrations.blockDestructive).toBe(false);
  });

  test("explicit blockDestructive=false in production is honoured", () => {
    const config = resolveLumoraConfig(
      {
        name: "test-prod-explicit-destructive",
        mode: "production",
        auth: { mode: "static", token: "secret" },
        database: { client: "sqlite", url: ":memory:" },
        migrations: { blockDestructive: false }
      },
      process.cwd()
    );
    expect(config.migrations.blockDestructive).toBe(false);
  });
});

describe("LP-02 · autoBackup defaults", () => {
  test("resolveLumoraConfig in production on sqlite sets autoBackup=true", () => {
    const config = resolveLumoraConfig(
      {
        name: "test-prod-backup",
        mode: "production",
        auth: { mode: "static", token: "secret" },
        database: { client: "sqlite", url: "sqlite://./prod.db" }
      },
      process.cwd()
    );
    expect(config.database.autoBackup).toBe(true);
  });

  test("resolveLumoraConfig in development on sqlite leaves autoBackup=false", () => {
    const config = resolveLumoraConfig(
      {
        name: "test-dev-backup",
        mode: "development",
        auth: { mode: "disabled" },
        database: { client: "sqlite", url: "sqlite://./dev.db" }
      },
      process.cwd()
    );
    expect(config.database.autoBackup).toBe(false);
  });

  test("explicit autoBackup=true in development is honoured", () => {
    const config = resolveLumoraConfig(
      {
        name: "test-dev-explicit-backup",
        mode: "development",
        auth: { mode: "disabled" },
        database: { client: "sqlite", url: "sqlite://./dev.db", autoBackup: true }
      },
      process.cwd()
    );
    expect(config.database.autoBackup).toBe(true);
  });
});

describe("LP-05 · Realtime routes opt-in", () => {
  test("GET /api/v1/todos/events returns 200 when realtime is enabled in real config", async () => {
    const configPath = path.join(import.meta.dir, "../lumora.config.ts");
    const lumora = await initLumora(configPath);
    
    // Check standard todos endpoint
    const todosRes = await lumora.app.request("/api/v1/todos");
    expect(todosRes.status).toBe(200);

    // Check realtime SSE endpoint
    const eventsRes = await lumora.app.request("/api/v1/todos/events");
    expect(eventsRes.status).toBe(200);

    await lumora.close();
  });

  test("GET /api/v1/todos/events returns 404 when realtime is disabled", async () => {
    const lumora = await initLumora({
      name: "test-realtime-disabled",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: { mode: "disabled" },
      database: { client: "sqlite", url: ":memory:" },
      realtime: { enabled: false },
      routes: { dir: path.join(import.meta.dir, "../routes") }
    });

    const eventsRes = await lumora.app.request("/api/v1/todos/events");
    expect(eventsRes.status).toBe(404);

    await lumora.close();
  });
});

describe("LP-01 · embeddedFiles migration source", () => {
  test("migration applies from embeddedFiles and GET /api/v1/todos returns 200", async () => {
    const initialSchemaSql = await readFile(
      path.join(import.meta.dir, "../migrations/sqlite/20260524_001_initial_schema.sql"),
      "utf8"
    );

    const lumora = await initLumora({
      name: "test-embedded-migrations",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: { mode: "disabled" },
      database: { client: "sqlite", url: ":memory:" },
      migrations: {
        embeddedFiles: {
          "20260524_001_initial_schema.sql": initialSchemaSql
        }
      },
      routes: { dir: path.join(import.meta.dir, "../routes") }
    });

    const response = await lumora.app.request("/api/v1/todos");
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    await lumora.close();
  });
});

describe("LP-04 · JWT afterVerify hook", () => {
  test("non-admin token is rejected with 403 and admin token succeeds with 200", async () => {
    const secret = "starter-jwt-secret";
    const lumora = await initLumora({
      name: "test-jwt-after-verify",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: {
        mode: "jwt",
        secret,
        customClaims: { fields: ["role"] },
        afterVerify: (auth) => {
          if (auth.claims?.role !== "admin") {
            return new Response("Forbidden", { status: 403 });
          }
        }
      },
      database: { client: "sqlite", url: ":memory:" },
      resources: [
        defineResource({
          resource: "items",
          fields: {
            title: { type: "string" }
          },
          auth: { mode: "inherit" }
        })
      ]
    });

    // 1. Non-admin token -> 403
    const memberToken = createJwt({ sub: "member-1", role: "member" }, secret);
    const memberRes = await lumora.app.request("/api/v1/items", {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    expect(memberRes.status).toBe(403);
    expect(await memberRes.text()).toBe("Forbidden");

    // 2. Admin token -> 200
    const adminToken = createJwt({ sub: "admin-1", role: "admin" }, secret);
    const adminRes = await lumora.app.request("/api/v1/items", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(adminRes.status).toBe(200);
    const adminBody = await adminRes.json() as any;
    expect(adminBody.ok).toBe(true);

    await lumora.close();
  });
});
