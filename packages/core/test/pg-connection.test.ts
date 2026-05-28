import { describe, expect, test } from "bun:test";
import { LumoraEventEmitter } from "../src/events";
import { LumoraDatabase } from "../src/db";
import pgConfig from "./pg.config";

describe("PostgreSQL Connection & DDL", () => {
  test("connects and sets search_path correctly", async () => {
    const events = new LumoraEventEmitter();
    const db = new LumoraDatabase(pgConfig.database as any, events);
    
    await db.connect();
    
    const rows = await db.sql.unsafe<{ search_path: string }[]>("SHOW search_path");
    expect(rows[0]?.search_path).toBe('"lumora_test_schema"');
    
    await db.close();
  });

  test("generates correct PostgreSQL DDL types", async () => {
    const events = new LumoraEventEmitter();
    const db = new LumoraDatabase(pgConfig.database as any, events);
    
    await db.connect();
    
    // Create schema to make sure it exists
    await db.sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "lumora_test_schema"`);
    
    await db.ensureResource({
      kind: "resource",
      resource: "pg_types_test",
      fields: {
        num: { type: "number" },
        bool: { type: "boolean" },
        js: { type: "json" },
        dt: { type: "datetime" },
        str: { type: "string" }
      }
    });
    
    const columns = await db.sql.unsafe<{ column_name: string; data_type: string }[]>(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'lumora_test_schema' 
        AND table_name = 'pg_types_test'
    `);
    
    const typeMap: Record<string, string> = {};
    for (const col of columns) {
      typeMap[col.column_name] = col.data_type.toUpperCase();
    }
    
    expect(typeMap["num"]).toBe("NUMERIC");
    expect(typeMap["bool"]).toBe("BOOLEAN");
    expect(typeMap["js"]).toBe("JSONB");
    expect(typeMap["dt"]).toContain("TIME WITH TIME ZONE");
    expect(typeMap["str"]).toBe("TEXT");
    
    await db.sql.unsafe(`DROP TABLE "lumora_test_schema"."pg_types_test"`);
    
    await db.close();
  });
});
