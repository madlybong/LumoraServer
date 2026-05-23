import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LumoraDatabase } from "../src/db";
import { LumoraMigrationEngine } from "../src/migrations";
import { LumoraEventEmitter } from "../src/events";
import { resolveLumoraConfig } from "../src/config";
import type { LumoraEventMap, LumoraConfig } from "../src/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createFixture(overrides: Partial<LumoraConfig> = {}) {
  const migrationsDir = await mkdtemp(path.join(os.tmpdir(), "lumora-migrations-"));

  const baseConfig: LumoraConfig = {
    name: "test",
    mode: "development",
    api: { base: "/api", version: "v1" },
    auth: { mode: "disabled" },
    database: { client: "sqlite", url: "sqlite://:memory:" },
    migrations: { dir: migrationsDir, mode: "auto" },
    ...overrides
  };

  const config = resolveLumoraConfig(baseConfig, migrationsDir);
  // Override resolved migrations.dir to our temp dir when mode is set via overrides
  const resolvedConfig = {
    ...config,
    migrations: {
      dir: migrationsDir,
      mode: config.migrations.mode
    }
  };

  const events = new LumoraEventEmitter<LumoraEventMap>();
  const db = new LumoraDatabase(baseConfig.database, events);
  await db.connect();

  return { db, config: resolvedConfig, migrationsDir };
}

async function addMigration(dir: string, filename: string, sql: string) {
  await writeFile(path.join(dir, filename), sql, "utf8");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("LumoraMigrationEngine", () => {
  test("creates _migrations ledger table on first run", async () => {
    const { db, config } = await createFixture();
    const engine = new LumoraMigrationEngine(db, config);

    await engine.run(); // no migration files — should still create the table

    // Verify ledger table exists by querying it
    const rows = await db.getAppliedMigrations();
    expect(Array.isArray(rows)).toBe(true);

    await db.close();
  });

  test("applies migrations in lexicographic order", async () => {
    const { db, config, migrationsDir } = await createFixture();

    await addMigration(
      migrationsDir,
      "20260524_001_create_users.sql",
      "CREATE TABLE IF NOT EXISTS `users` (`id` VARCHAR(191) PRIMARY KEY, `name` TEXT NOT NULL, `created_at` TEXT NOT NULL, `updated_at` TEXT NOT NULL)"
    );
    await addMigration(
      migrationsDir,
      "20260524_002_create_orders.sql",
      "CREATE TABLE IF NOT EXISTS `orders` (`id` VARCHAR(191) PRIMARY KEY, `user_id` TEXT NOT NULL, `created_at` TEXT NOT NULL, `updated_at` TEXT NOT NULL)"
    );

    const engine = new LumoraMigrationEngine(db, config);
    await engine.run();

    const applied = await db.getAppliedMigrations();
    expect(applied.length).toBe(2);
    expect(applied[0]?.name).toBe("20260524_001_create_users");
    expect(applied[1]?.name).toBe("20260524_002_create_orders");

    await db.close();
  });

  test("does not re-apply already applied migrations (idempotency)", async () => {
    const { db, config, migrationsDir } = await createFixture();

    await addMigration(
      migrationsDir,
      "20260524_001_create_tags.sql",
      "CREATE TABLE IF NOT EXISTS `tags` (`id` VARCHAR(191) PRIMARY KEY, `name` TEXT NOT NULL, `created_at` TEXT NOT NULL, `updated_at` TEXT NOT NULL)"
    );

    const engine = new LumoraMigrationEngine(db, config);
    await engine.run();

    // Run again — should not duplicate
    await engine.run();

    const applied = await db.getAppliedMigrations();
    expect(applied.length).toBe(1);

    await db.close();
  });

  test("status() returns correct applied/pending split", async () => {
    const { db, config, migrationsDir } = await createFixture();

    await addMigration(migrationsDir, "20260524_001_a.sql", "SELECT 1");
    await addMigration(migrationsDir, "20260524_002_b.sql", "SELECT 2");

    const engine = new LumoraMigrationEngine(db, config);

    // Before any apply
    const before = await engine.status();
    expect(before.applied.length).toBe(0);
    expect(before.pending).toContain("20260524_001_a");
    expect(before.pending).toContain("20260524_002_b");

    // Apply first migration manually
    await engine.applyPending();

    const after = await engine.status();
    expect(after.applied.length).toBe(2);
    expect(after.pending.length).toBe(0);

    await db.close();
  });

  test("strict mode throws if pending migrations exist", async () => {
    const { db, config, migrationsDir } = await createFixture({
      migrations: { mode: "strict" }
    });

    await addMigration(migrationsDir, "20260524_001_strict.sql", "SELECT 1");

    const engine = new LumoraMigrationEngine(db, config);

    await expect(engine.run()).rejects.toThrow("bun run lumora migrate");

    await db.close();
  });

  test("strict mode passes when no pending migrations", async () => {
    const { db, config, migrationsDir } = await createFixture({
      migrations: { mode: "strict" }
    });

    await addMigration(migrationsDir, "20260524_001_already_done.sql", "SELECT 1");

    // Apply first, then check strict mode is happy
    const engineAuto = new LumoraMigrationEngine(db, {
      ...config,
      migrations: { ...config.migrations, mode: "auto" }
    });
    await engineAuto.applyPending();

    // Now strict mode should not throw
    const engineStrict = new LumoraMigrationEngine(db, config);
    await expect(engineStrict.run()).resolves.toBeUndefined();

    await db.close();
  });

  test("off mode skips engine entirely — no ledger table created", async () => {
    const { db, config, migrationsDir } = await createFixture({
      migrations: { mode: "off" }
    });

    await addMigration(migrationsDir, "20260524_001_should_skip.sql", "SELECT 1");

    const engine = new LumoraMigrationEngine(db, config);
    await engine.run();

    // _migrations table should not exist
    let tableExists = true;
    try {
      await db.sql.unsafe("SELECT 1 FROM `_migrations` LIMIT 1");
    } catch {
      tableExists = false;
    }
    expect(tableExists).toBe(false);

    await db.close();
  });

  test("dry-run returns SQL without applying", async () => {
    const { db, config, migrationsDir } = await createFixture();

    const sql = "CREATE TABLE IF NOT EXISTS `dry` (`id` VARCHAR(191) PRIMARY KEY, `created_at` TEXT NOT NULL, `updated_at` TEXT NOT NULL)";
    await addMigration(migrationsDir, "20260524_001_dry.sql", sql);

    const engine = new LumoraMigrationEngine(db, config);
    const results = await engine.applyPending({ dryRun: true });

    expect(results.length).toBe(1);
    expect(results[0]?.dryRun).toBe(true);
    expect(results[0]?.sql).toBe(sql);

    // Nothing should be recorded in the ledger
    await db.ensureMigrationsTable();
    const applied = await db.getAppliedMigrations();
    expect(applied.length).toBe(0);

    await db.close();
  });

  test("failed migration rolls back and surfaces error", async () => {
    const { db, config, migrationsDir } = await createFixture();

    await addMigration(migrationsDir, "20260524_001_bad.sql", "THIS IS NOT VALID SQL !!!!");

    const engine = new LumoraMigrationEngine(db, config);
    await expect(engine.run()).rejects.toThrow();

    // Nothing should be committed
    await db.ensureMigrationsTable();
    const applied = await db.getAppliedMigrations();
    expect(applied.length).toBe(0);

    await db.close();
  });

  test("missing migrations directory is treated as no migrations", async () => {
    const { db, config } = await createFixture({
      migrations: { dir: "/non/existent/migrations/dir", mode: "auto" }
    });

    const resolvedConfig = {
      ...config,
      migrations: {
        dir: "/non/existent/migrations/dir",
        mode: "auto" as const
      }
    };

    const engine = new LumoraMigrationEngine(db, resolvedConfig);
    await expect(engine.run()).resolves.toBeUndefined();

    await db.close();
  });
});
