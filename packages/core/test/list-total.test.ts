import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";

async function createFixtureApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-list-total-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "item.ts"),
    `export default {
  kind: "resource",
  resource: "item",
  fields: {
    name: { type: "string", required: true, filterable: true }
  },
  query: { defaultPageSize: 5, maxPageSize: 20 }
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

  // Seed 12 items
  for (let i = 0; i < 12; i++) {
    await lumora.app.request("/api/v1/item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `Item ${i + 1}` })
    });
  }

  return { root, lumora };
}

describe("List total and pagination", () => {
  test("response includes total count", async () => {
    const { lumora } = await createFixtureApp();

    const res = await lumora.app.request("/api/v1/item");
    const body = await res.json() as any;
    expect(body.total).toBe(12);
    expect(body.data.length).toBe(5); // defaultPageSize = 5
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(5);

    await lumora.close();
  });

  test("?limit= works as alias for ?pageSize=", async () => {
    const { lumora } = await createFixtureApp();

    const res = await lumora.app.request("/api/v1/item?limit=3");
    const body = await res.json() as any;
    expect(body.data.length).toBe(3);
    expect(body.total).toBe(12);
    expect(body.pageSize).toBe(3);

    await lumora.close();
  });

  test("?page=2 paginates correctly and does not become a filter", async () => {
    const { lumora } = await createFixtureApp();

    const res = await lumora.app.request("/api/v1/item?page=2&pageSize=5");
    const body = await res.json() as any;
    expect(body.data.length).toBe(5);
    expect(body.total).toBe(12);
    expect(body.page).toBe(2);

    await lumora.close();
  });

  test("?page=3 returns remaining items", async () => {
    const { lumora } = await createFixtureApp();

    const res = await lumora.app.request("/api/v1/item?page=3&pageSize=5");
    const body = await res.json() as any;
    expect(body.data.length).toBe(2); // 12 total, page 3 of 5 = last 2
    expect(body.total).toBe(12);

    await lumora.close();
  });
});
