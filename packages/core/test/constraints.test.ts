import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";

async function createConstraintApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-constraints-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(
    path.join(routesDir, "product.ts"),
    `export default {
  kind: "resource",
  resource: "product",
  fields: {
    sku: { type: "string", required: true, unique: true },
    name: { type: "string", required: true, indexed: true },
    category: { type: "string" }
  }
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

describe("Unique constraints", () => {
  test("duplicate unique field throws error", async () => {
    const { lumora } = await createConstraintApp();

    const first = await lumora.app.request("/api/v1/product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "SKU-001", name: "Widget A" })
    });
    expect(first.status).toBe(201);

    const duplicate = await lumora.app.request("/api/v1/product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "SKU-001", name: "Widget B" })
    });
    // Should fail due to unique constraint
    expect(duplicate.status).toBe(500);

    await lumora.close();
  });

  test("different unique values succeed", async () => {
    const { lumora } = await createConstraintApp();

    const first = await lumora.app.request("/api/v1/product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "SKU-A", name: "Widget A" })
    });
    expect(first.status).toBe(201);

    const second = await lumora.app.request("/api/v1/product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "SKU-B", name: "Widget B" })
    });
    expect(second.status).toBe(201);

    await lumora.close();
  });
});
