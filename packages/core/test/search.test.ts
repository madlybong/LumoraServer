import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";

async function createSearchableApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-search-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "product.ts"),
    `export default {
  kind: "resource",
  resource: "product",
  fields: {
    name: { type: "string", required: true, searchable: true, filterable: true },
    sku: { type: "string", searchable: true },
    category: { type: "string", filterable: true }
  },
  query: { defaultPageSize: 20, maxPageSize: 100 }
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

  // Seed data
  for (const item of [
    { name: "Gold Ring", sku: "GR-001", category: "rings" },
    { name: "Silver Ring", sku: "SR-001", category: "rings" },
    { name: "Gold Necklace", sku: "GN-001", category: "necklaces" },
    { name: "Diamond Pendant", sku: "DP-001", category: "pendants" }
  ]) {
    await lumora.app.request("/api/v1/product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item)
    });
  }

  return { root, lumora };
}

describe("Search", () => {
  test("?search= filters on searchable fields", async () => {
    const { lumora } = await createSearchableApp();

    const res = await lumora.app.request("/api/v1/product?search=Gold");
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.data.every((r: any) => r.name.includes("Gold") || r.sku.includes("Gold"))).toBe(true);

    await lumora.close();
  });

  test("?search= with no matches returns empty", async () => {
    const { lumora } = await createSearchableApp();

    const res = await lumora.app.request("/api/v1/product?search=Platinum");
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.length).toBe(0);
    expect(body.total).toBe(0);

    await lumora.close();
  });

  test("?search= combined with filter", async () => {
    const { lumora } = await createSearchableApp();

    const res = await lumora.app.request("/api/v1/product?search=Ring&category=rings");
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.length).toBe(2);

    await lumora.close();
  });
});
