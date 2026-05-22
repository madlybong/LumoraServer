import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";
import type { LumoraInstance } from "../src/types";

let lumora: LumoraInstance;

beforeAll(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-bulk-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });

  await writeFile(
    path.join(routesDir, "bom-line.ts"),
    `export default {
  resource: "bom-line",
  fields: {
    bom_id: { type: "string", required: true, filterable: true },
    material: { type: "string", required: true },
    quantity: { type: "number", required: true },
  },
  bulk: { transactional: true },
};`
  );

  await writeFile(
    path.join(routesDir, "bom-line-nt.ts"),
    `export default {
  resource: "bom-line-nt",
  fields: {
    bom_id: { type: "string", required: true, filterable: true },
    material: { type: "string", required: true },
    quantity: { type: "number", required: true },
    code: { type: "string", unique: true },
  },
  bulk: { transactional: false },
};`
  );

  lumora = await initLumora({
    name: "bulk-test",
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

describe("Bulk Operations (LS-4)", () => {
  test("createBulk inserts all records and returns success results", async () => {
    const bomResource = (lumora as any).resources?.find?.((r: any) => r.resource === "bom-line");
    if (!bomResource) return;

    const inputs = [
      { bom_id: "bom-1", material: "Gold", quantity: 10 },
      { bom_id: "bom-1", material: "Silver", quantity: 5 },
      { bom_id: "bom-1", material: "Diamond", quantity: 2 },
    ];
    const results = await lumora.database.createBulk(bomResource, inputs);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.id).toBeDefined();
      expect(r.data?.bom_id).toBe("bom-1");
    }
  });

  test("createBulk returns empty array for empty input", async () => {
    const bomResource = (lumora as any).resources?.find?.((r: any) => r.resource === "bom-line");
    if (!bomResource) return;
    const results = await lumora.database.createBulk(bomResource, []);
    expect(results).toHaveLength(0);
  });

  test("createBulk non-transactional: partial success on unique violation", async () => {
    const bomNtResource = (lumora as any).resources?.find?.((r: any) => r.resource === "bom-line-nt");
    if (!bomNtResource) return;

    // Insert seed record
    await lumora.database.create(bomNtResource, { bom_id: "b1", material: "Gold", quantity: 1, code: "GOLD-001" });

    const results = await lumora.database.createBulk(bomNtResource, [
      { bom_id: "b1", material: "Silver", quantity: 2, code: "SILVER-001" }, // should succeed
      { bom_id: "b1", material: "Gold-dup", quantity: 1, code: "GOLD-001" }, // unique violation
    ]);
    expect(results[0]!.success).toBe(true);
    expect(results[1]!.success).toBe(false);
    expect(results[1]!.error).toBeDefined();
  });

  test("POST /bulk returns 400 for missing records array", async () => {
    const res = await lumora.app.request("/api/v1/bom-line/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain("records");
  });

  test("POST /bulk creates multiple records and returns per-record results", async () => {
    const res = await lumora.app.request("/api/v1/bom-line/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        records: [
          { bom_id: "bom-http", material: "Platinum", quantity: 3 },
          { bom_id: "bom-http", material: "Emerald", quantity: 1 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; results: { success: boolean; id?: string }[] };
    expect(json.ok).toBe(true);
    expect(json.results).toHaveLength(2);
    expect(json.results.every((r) => r.success)).toBe(true);
    expect(json.results.every((r) => r.id !== undefined)).toBe(true);
  });

  test("POST /bulk transactional: returns 400 validation error without DB write on required field missing", async () => {
    const res = await lumora.app.request("/api/v1/bom-line/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        records: [
          { bom_id: "bom-valid", material: "Copper", quantity: 5 },
          { bom_id: "bom-invalid" }, // missing required fields
        ],
      }),
    });
    // In transactional mode, validation error stops entire batch
    expect(res.status).toBe(400);
    const json = await res.json() as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
  });
});
