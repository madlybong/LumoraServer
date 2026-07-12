import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";

async function createFixtureApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-runtime-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "company.ts"),
    `export default {
  kind: "resource",
  resource: "company",
  fields: {
    name: { type: "string", required: true, filterable: true, sortable: true },
    active: { type: "boolean", default: true, filterable: true }
  },
  query: { defaultPageSize: 10, maxPageSize: 50 }
};`
  );

  const lumora = await initLumora({
    name: "fixture",
    mode: "development",
    api: { base: "/api", version: "v1" },
    auth: { mode: "disabled" },
    database: { client: "sqlite", url: "sqlite://:memory:" },
    routes: { dir: routesDir }
  });

  return { root, lumora };
}

describe("initLumora", () => {
  test("discovers routes and serves CRUD + docs", async () => {
    const { lumora } = await createFixtureApp();
    const createResponse = await lumora.app.request("/api/v1/company", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme" })
    });
    const created = await createResponse.json() as { data: { name: string } };
    expect(createResponse.status).toBe(201);
    expect(created.data.name).toBe("Acme");

    const listResponse = await lumora.app.request("/api/v1/company");
    const listed = await listResponse.json() as { data: unknown[]; total: number };
    expect(listed.data.length).toBe(1);
    expect(listed.total).toBe(1);

    const docsResponse = await lumora.app.request("/__lumora/openapi.json");
    const docs = await docsResponse.json() as { paths: Record<string, unknown> };
    expect(docs.paths["/api/v1/company"]).toBeDefined();

    await lumora.close();
  });

  test("emits resource and db events", async () => {
    const { lumora } = await createFixtureApp();
    const seen: string[] = [];
    lumora.events.on("resource:create:after", () => seen.push("resource"));
    lumora.events.on("db:transaction:after", () => seen.push("db"));

    await lumora.app.request("/api/v1/company", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Orbit" })
    });

    expect(seen).toContain("resource");
    expect(seen).toContain("db");
    await lumora.close();
  });

  test("enforces static auth in production", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lumora-auth-"));
    const routesDir = path.join(root, "routes");
    await mkdir(routesDir, { recursive: true });
    await writeFile(
      path.join(routesDir, "company.ts"),
      `export default {
  kind: "resource",
  resource: "company",
  fields: { name: { type: "string", required: true } }
};`
    );
    const lumora = await initLumora({
      name: "secure",
      mode: "production",
      api: { base: "/api", version: "v1" },
      auth: { mode: "static", token: "secret" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      routes: { dir: routesDir }
    });

    const denied = await lumora.app.request("/api/v1/company");
    expect(denied.status).toBe(401);

    const allowed = await lumora.app.request("/api/v1/company", {
      headers: { authorization: "Bearer secret" }
    });
    expect(allowed.status).toBe(200);
    await lumora.close();
  });

  test("exposes apiPrefix getter", async () => {
    const { lumora } = await createFixtureApp();
    expect(lumora.apiPrefix).toBe("/api/v1");
    await lumora.close();
  });

  test("mountModule mounts custom router", async () => {
    const { lumora } = await createFixtureApp();
    const { Hono } = await import("hono");
    const router = new Hono();
    router.get("/hello", (c) => c.text("world"));
    lumora.mountModule("/custom", router);
    
    const res = await lumora.app.request("/api/v1/custom/hello");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("world");
    await lumora.close();
  });

  test("createModuleContext returns correct shape", async () => {
    const { lumora } = await createFixtureApp();
    const { createModuleContext } = await import("../src/runtime");
    const ctx = createModuleContext(lumora);
    
    expect(ctx.db).toBeDefined();
    expect(ctx.auth).toBeDefined();
    expect(ctx.logAudit).toBeTypeOf("function");
    await lumora.close();
  });
});
