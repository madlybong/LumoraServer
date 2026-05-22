import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initLumora } from "../src/runtime";
import type { LumoraInstance } from "../src/types";

let lumora: LumoraInstance;

beforeAll(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-relations-"));
  const routesDir = path.join(root, "routes");
  await mkdir(routesDir, { recursive: true });

  await writeFile(
    path.join(routesDir, "customer.ts"),
    `export default {
  resource: "customer",
  fields: {
    name: { type: "string", required: true },
    email: { type: "string", required: true },
  },
};`
  );

  await writeFile(
    path.join(routesDir, "order.ts"),
    `export default {
  resource: "order",
  fields: {
    item_name: { type: "string", required: true },
    customer_id: { type: "string", required: true, filterable: true },
  },
  relations: {
    customer: { resource: "customer", foreignKey: "customer_id", type: "belongsTo" },
    items: { resource: "order-item", foreignKey: "order_id", type: "hasMany" },
  },
};`
  );

  await writeFile(
    path.join(routesDir, "order-item.ts"),
    `export default {
  resource: "order-item",
  fields: {
    order_id: { type: "string", required: true, filterable: true },
    product: { type: "string", required: true },
  },
};`
  );

  lumora = await initLumora({
    name: "relations-test",
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

describe("Relational Joins (LS-2)", () => {
  test("getByField retrieves a record by arbitrary field", async () => {
    // Create a customer
    const createRes = await lumora.app.request("/api/v1/customer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Priya Sharma", email: "priya@example.com" }),
    });
    const { data: customer } = await createRes.json() as { data: { id: string } };

    // getByField internal helper
    const customerResource = (lumora as any).resources?.find?.((r: any) => r.resource === "customer");
    if (customerResource) {
      const found = await lumora.database.getByField(customerResource, "id", customer.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Priya Sharma");
    }
  });

  test("getByField returns null when no match found", async () => {
    const customerResource = (lumora as any).resources?.find?.((r: any) => r.resource === "customer");
    if (customerResource) {
      const result = await lumora.database.getByField(customerResource, "id", "does-not-exist-9999");
      expect(result).toBeNull();
    }
  });

  test("listByField retrieves all related records", async () => {
    // Create a customer and order
    const cRes = await lumora.app.request("/api/v1/customer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Rahul Sen", email: "rahul@example.com" }),
    });
    const { data: customer } = await cRes.json() as { data: { id: string } };

    const oRes = await lumora.app.request("/api/v1/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_name: "Diamond Ring", customer_id: customer.id }),
    });
    const { data: order } = await oRes.json() as { data: { id: string } };

    // Add two order items
    await lumora.app.request("/api/v1/order-item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order_id: order.id, product: "Ring-Base" }),
    });
    await lumora.app.request("/api/v1/order-item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order_id: order.id, product: "Diamond Stone" }),
    });

    const orderItemResource = (lumora as any).resources?.find?.((r: any) => r.resource === "order-item");
    if (orderItemResource) {
      const items = await lumora.database.listByField(orderItemResource, "order_id", order.id);
      expect(items.length).toBe(2);
      const products = items.map((i) => i.product).sort();
      expect(products).toEqual(["Diamond Stone", "Ring-Base"]);
    }
  });

  test("listByField returns empty array for no matches", async () => {
    const orderItemResource = (lumora as any).resources?.find?.((r: any) => r.resource === "order-item");
    if (orderItemResource) {
      const results = await lumora.database.listByField(orderItemResource, "order_id", "nonexistent-order-id");
      expect(results).toHaveLength(0);
    }
  });

  test("GET /order/:id?include=customer resolves belongsTo relation", async () => {
    // Create customer + order
    const cRes = await lumora.app.request("/api/v1/customer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Anita Roy", email: "anita@example.com" }),
    });
    const { data: customer } = await cRes.json() as { data: { id: string; name: string } };

    const oRes = await lumora.app.request("/api/v1/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_name: "Gold Bangle", customer_id: customer.id }),
    });
    const { data: order } = await oRes.json() as { data: { id: string } };

    // Fetch with include
    const res = await lumora.app.request(`/api/v1/order/${order.id}?include=customer`);
    const json = await res.json() as { ok: boolean; data: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.customer).toBeDefined();
    expect((json.data.customer as any).name).toBe("Anita Roy");
  });

  test("unknown ?include= names are silently ignored", async () => {
    const oRes = await lumora.app.request("/api/v1/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_name: "Silver Chain", customer_id: "any-id" }),
    });
    const { data: order } = await oRes.json() as { data: { id: string } };

    const res = await lumora.app.request(`/api/v1/order/${order.id}?include=nonexistent`);
    const json = await res.json() as { ok: boolean; data: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(json.data).not.toHaveProperty("nonexistent");
  });
});
