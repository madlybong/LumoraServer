import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { LumoraEventEmitter } from "../src/events";
import { LumoraDatabase } from "../src/db";
import pgConfig from "./pg.config";
import type { DefineResourceResult } from "../src/types";

describe("PostgreSQL CRUD", () => {
  let db: LumoraDatabase;
  const resource: DefineResourceResult = {
    kind: "resource",
    resource: "pg_crud_test",
    fields: {
      name: { type: "string", searchable: true, sortable: true },
      age: { type: "number", filterable: true, sortable: true },
      is_active: { type: "boolean", filterable: true },
      meta: { type: "json" }
    }
  };

  beforeAll(async () => {
    db = new LumoraDatabase(pgConfig.database as any, new LumoraEventEmitter());
    await db.connect();
    await db.sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "lumora_test_schema"`);
    await db.sql.unsafe(`DROP TABLE IF EXISTS "lumora_test_schema"."pg_crud_test"`);
    await db.ensureResource(resource);
  });

  afterAll(async () => {
    await db.close();
  });

  test("create, get, list, update, delete", async () => {
    // Create
    const created = await db.create(resource, { name: "Alice", age: 30, is_active: true, meta: { role: "admin" } });
    expect(created.id).toBeDefined();
    expect(created.name).toBe("Alice");
    expect(created.age).toBe(30);
    expect(created.is_active).toBe(true);
    expect((created.meta as any).role).toBe("admin");

    const id = created.id as string;

    // Get
    const fetched = await db.get(resource, id);
    expect(fetched?.name).toBe("Alice");

    // Update
    const updated = await db.update(resource, id, { age: 31, is_active: false });
    expect(updated?.age).toBe(31);
    expect(updated?.is_active).toBe(false);

    // List
    await db.create(resource, { name: "Bob", age: 25, is_active: true });
    const listed = await db.list(resource, { filters: new URLSearchParams(), page: 1, pageSize: 10 });
    expect(listed.total).toBe(2);
    expect(listed.items.length).toBe(2);

    // Delete
    const deleted = await db.delete(resource, id);
    expect(deleted?.id).toBe(id);

    const fetchedAfterDelete = await db.get(resource, id);
    expect(fetchedAfterDelete).toBeNull();
  });
});
