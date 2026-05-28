import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { LumoraEventEmitter } from "../src/events";
import { LumoraDatabase } from "../src/db";
import pgConfig from "./pg.config";

describe("PostgreSQL Migrations Engine", () => {
  let db: LumoraDatabase;

  beforeAll(async () => {
    db = new LumoraDatabase(pgConfig.database as any, new LumoraEventEmitter());
    await db.connect();
    await db.sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "lumora_test_schema"`);
    await db.sql.unsafe(`DROP TABLE IF EXISTS "lumora_test_schema"."_migrations"`);
  });

  afterAll(async () => {
    await db.close();
  });

  test("ensureMigrationsTable creates schema-qualified table", async () => {
    await db.ensureMigrationsTable();
    
    const rows = await db.sql.unsafe<{ to_regclass: string }[]>(`SELECT to_regclass('"lumora_test_schema"."_migrations"')`);
    expect(rows[0]?.to_regclass).toBeTruthy();
  });

  test("recordMigration and getAppliedMigrations", async () => {
    await db.recordMigration("001_init", "12345");
    await db.recordMigration("002_add", "67890");
    
    const migrations = await db.getAppliedMigrations();
    expect(migrations.length).toBe(2);
    expect(migrations[0]?.name).toBe("001_init");
    expect(migrations[0]?.checksum).toBe("12345");
    expect(migrations[1]?.name).toBe("002_add");
    expect(migrations[1]?.checksum).toBe("67890");
  });
});
