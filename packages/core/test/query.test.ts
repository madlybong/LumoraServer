import { describe, expect, test } from "bun:test";
import { initLumora } from "../src/runtime";

// Tests for LS-11: Structured Query Interface (QueryExecutor)
// Uses inline resources for isolation.

describe("QueryExecutor (LS-11)", () => {
  test("rejects unknown resource", async () => {
    const lumora = await initLumora({
      name: "fixture",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: { mode: "disabled" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      resources: [{
        resource: "product",
        fields: { name: { type: "string", required: true } }
      } as any]
    });

    const result = await lumora.query.execute(
      { resource: "nonexistent" },
      { resources: lumora.resources, database: lumora.database }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("nonexistent");
    }

    await lumora.close();
  });

  test("rejects unknown filter field", async () => {
    const lumora = await initLumora({
      name: "fixture",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: { mode: "disabled" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      resources: [{
        resource: "widget",
        fields: { name: { type: "string", required: true } }
      } as any]
    });

    const result = await lumora.query.execute(
      {
        resource: "widget",
        filters: [{ field: "unknownField", value: "test" }]
      },
      { resources: lumora.resources, database: lumora.database }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unknownField");
    }

    await lumora.close();
  });

  test("returns all rows for valid query", async () => {
    const lumora = await initLumora({
      name: "fixture",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: { mode: "disabled" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      resources: [{
        resource: "item",
        fields: {
          name: { type: "string", required: true },
          price: { type: "number", required: true }
        }
      } as any]
    });

    // Seed data via HTTP
    await lumora.app.request("/api/v1/item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Widget A", price: 10 })
    });
    await lumora.app.request("/api/v1/item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Widget B", price: 20 })
    });

    const result = await lumora.query.execute(
      { resource: "item" },
      { resources: lumora.resources, database: lumora.database }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBe(2);
    }

    await lumora.close();
  });

  test("filter eq returns only matching rows", async () => {
    const lumora = await initLumora({
      name: "fixture",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: { mode: "disabled" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      resources: [{
        resource: "cat",
        fields: {
          color: { type: "string", required: true }
        }
      } as any]
    });

    await lumora.app.request("/api/v1/cat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color: "red" })
    });
    await lumora.app.request("/api/v1/cat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color: "blue" })
    });

    const result = await lumora.query.execute(
      {
        resource: "cat",
        filters: [{ field: "color", value: "red" }]
      },
      { resources: lumora.resources, database: lumora.database }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBe(1);
      expect(result.data[0]?.color).toBe("red");
    }

    await lumora.close();
  });

  test("limit restricts result count", async () => {
    const lumora = await initLumora({
      name: "fixture",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: { mode: "disabled" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      resources: [{
        resource: "log",
        fields: { message: { type: "string", required: true } }
      } as any]
    });

    for (let i = 0; i < 5; i++) {
      await lumora.app.request("/api/v1/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: `Log ${i}` })
      });
    }

    const result = await lumora.query.execute(
      { resource: "log", limit: 3 },
      { resources: lumora.resources, database: lumora.database }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBe(3);
    }

    await lumora.close();
  });

  test("query executor is exposed on lumora instance", async () => {
    const lumora = await initLumora({
      name: "fixture",
      mode: "development",
      api: { base: "/api", version: "v1" },
      auth: { mode: "disabled" },
      database: { client: "sqlite", url: "sqlite://:memory:" },
      resources: []
    });

    expect(lumora.query).toBeDefined();
    expect(typeof lumora.query.execute).toBe("function");

    await lumora.close();
  });
});
