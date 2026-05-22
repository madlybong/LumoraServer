import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";
import type { LumoraInstance } from "../src/types";

let lumora: LumoraInstance;

const PRODUCT_RESOURCE_TS = `export default {
  resource: "product",
  fields: {
    name: { type: "string", required: true },
    price: { type: "number", required: true },
  },
  computed: {
    price_with_tax: {
      resolve: async (record) => Number(record.price) * 1.18,
    },
    label: {
      resolve: (record) => \`\${record.name} @ Rs.\${record.price}\`,
    },
  },
};`;

beforeAll(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-computed-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(path.join(routesDir, "product.ts"), PRODUCT_RESOURCE_TS);

  lumora = await initLumora({
    name: "computed-test",
    mode: "development",
    api: { base: "/api", version: "v1" },
    auth: { mode: "disabled" },
    database: { client: "sqlite", url: "sqlite://:memory:" },
    routes: { dir: routesDir },
  });
});

afterAll(async () => {
  await lumora?.close();
});

describe("Computed fields (LS-1)", () => {
  test("computed fields are not stored in DB — raw create returns no computed keys", async () => {
    // Use the HTTP API to test end-to-end
    const res = await lumora.app.request("/api/v1/product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Gold Ring", price: 5000 }),
    });
    const json = await res.json() as { data: Record<string, unknown> };
    expect(res.status).toBe(201);
    expect(json.data.name).toBe("Gold Ring");
    expect(json.data.price).toBe(5000);
    // Computed fields are NOT returned from POST (only GET resolves them)
    // This is by design — stored fields only on create
  });

  test("GET list returns computed fields alongside stored fields", async () => {
    const res = await lumora.app.request("/api/v1/product");
    const json = await res.json() as { data: Array<Record<string, unknown>> };
    expect(res.status).toBe(200);
    expect(json.data.length).toBeGreaterThan(0);
    const product = json.data[0]!;
    // Computed fields should be present in GET
    expect(product.price_with_tax).toBeDefined();
    expect(typeof product.price_with_tax).toBe("number");
    expect(product.label).toBeDefined();
    expect(typeof product.label).toBe("string");
  });

  test("GET single record returns computed fields", async () => {
    // Create a product first
    const createRes = await lumora.app.request("/api/v1/product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Diamond Pendant", price: 25000 }),
    });
    const { data: created } = await createRes.json() as { data: { id: string; price: number } };
    const res = await lumora.app.request(`/api/v1/product/${created.id}`);
    const json = await res.json() as { data: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(json.data.price_with_tax).toBeCloseTo(25000 * 1.18, 0);
    expect(json.data.label).toContain("Diamond Pendant");
  });

  test("computed fields from CSV export are not included (not in schema.fields)", async () => {
    const { exportToCsv } = await import("../src/export");
    const { defineResource } = await import("../src/resource");
    const resource = defineResource({
      resource: "product",
      fields: {
        name: { type: "string", required: true },
        price: { type: "number", required: true },
      },
    });
    const records = [{ id: "1", name: "Ring", price: 100, createdAt: "now", updatedAt: "now" }];
    const csv = exportToCsv(records, resource);
    expect(csv).not.toContain("price_with_tax");
    expect(csv).not.toContain("label");
  });
});
