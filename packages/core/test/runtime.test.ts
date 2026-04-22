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
    const listed = await listResponse.json() as { data: { items: unknown[] } };
    expect(listed.data.items.length).toBe(1);

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
});
