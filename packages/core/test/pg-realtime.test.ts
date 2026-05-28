import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { LumoraEventEmitter } from "../src/events";
import { LumoraDatabase } from "../src/db";
import pgConfig from "./pg.config";
import type { DefineResourceResult } from "../src/types";

describe("PostgreSQL Realtime Events", () => {
  let db: LumoraDatabase;
  let events: LumoraEventEmitter<any>;

  const resource: DefineResourceResult = {
    kind: "resource",
    resource: "pg_rt_test",
    fields: {
      name: { type: "string" }
    }
  };

  beforeAll(async () => {
    events = new LumoraEventEmitter();
    db = new LumoraDatabase(pgConfig.database as any, events);
    await db.connect();
    await db.sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "lumora_test_schema"`);
    await db.sql.unsafe(`DROP TABLE IF EXISTS "lumora_test_schema"."pg_rt_test"`);
    await db.ensureResource(resource);
  });

  afterAll(async () => {
    await db.close();
  });

  test("emits db:transaction:after on create", async () => {
    return new Promise<void>((resolve) => {
      events.on("db:transaction:after", (payload: any) => {
        expect(payload.resource).toBe("pg_rt_test");
        expect(payload.action).toBe("create");
        resolve();
      });
      db.create(resource, { name: "test-event" }).catch(() => {});
    });
  });
});
