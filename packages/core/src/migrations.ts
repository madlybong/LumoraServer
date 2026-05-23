import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { LumoraDatabase, MigrationRecord } from "./db";
import type { ResolvedLumoraConfig } from "./types";
import type { LumoraLogger } from "./logger";

export interface MigrationStatus {
  applied: MigrationRecord[];
  pending: string[]; // file stems not yet in the ledger
}

export interface MigrationApplyResult {
  name: string;
  success: boolean;
  dryRun?: boolean;
  sql?: string;
  error?: string;
}

/**
 * LumoraMigrationEngine
 *
 * Discovers *.sql files in config.migrations.dir (date-prefixed: YYYYMMDD_NNN_description.sql),
 * applies pending migrations in lexicographic order, and records each in the _migrations ledger.
 *
 * Mode behaviour (set via config.migrations.mode or auto-resolved from config.mode):
 *   "auto"   — applies pending migrations on startup whenever:
 *                • the app is starting fresh (no ledger yet), OR
 *                • new .sql files exist that haven't been applied yet (schema changed).
 *              If nothing is pending, startup is instant with no DB writes.
 *   "strict" — fails startup if any pending migrations exist; operator must run
 *              `bun run lumora migrate` explicitly before deploying.
 *   "off"    — skips engine entirely (used in test mode).
 */
export class LumoraMigrationEngine {
  constructor(
    private readonly db: LumoraDatabase,
    private readonly config: ResolvedLumoraConfig,
    private readonly logger?: LumoraLogger
  ) {}

  /**
   * Mode-aware entry point called by initLumora during startup.
   */
  async run(): Promise<void> {
    const mode = this.config.migrations.mode;
    if (mode === "off") return;

    await this.db.ensureMigrationsTable();
    const { pending } = await this.status();

    if (pending.length === 0) return;

    if (mode === "auto") {
      this.logger?.event("migrate", `${pending.length} pending migration(s) — applying now (schema changed / fresh start)...`);
      await this.applyPending();
      return;
    }

    // "strict" — fail startup with a clear action message
    throw new Error(
      `[lumora] ${pending.length} pending migration(s) detected:\n` +
      pending.map((f) => `  • ${f}`).join("\n") +
      `\n\nRun the following command before starting the server:\n  bun run lumora migrate`
    );
  }

  /**
   * Return current applied / pending status.
   */
  async status(): Promise<MigrationStatus> {
    await this.db.ensureMigrationsTable();
    const applied = await this.db.getAppliedMigrations();
    const appliedNames = new Set(applied.map((r) => r.name));
    const files = await this.discoverFiles();
    const pending = files
      .map((f) => path.basename(f, ".sql"))
      .filter((stem) => !appliedNames.has(stem));
    return { applied, pending };
  }

  /**
   * Apply all pending migrations sequentially.
   * @param opts.dryRun — print SQL without applying (used by CLI --dry-run)
   */
  async applyPending(opts: { dryRun?: boolean } = {}): Promise<MigrationApplyResult[]> {
    await this.db.ensureMigrationsTable();

    const applied = await this.db.getAppliedMigrations();
    const appliedMap = new Map(applied.map((r) => [r.name, r]));

    const files = await this.discoverFiles();
    const results: MigrationApplyResult[] = [];

    for (const file of files) {
      const stem = path.basename(file, ".sql");
      if (appliedMap.has(stem)) {
        // Already applied — optionally warn on checksum drift
        const existing = appliedMap.get(stem)!;
        const content = await readFile(file, "utf8");
        const checksum = sha256(content);
        if (checksum !== existing.checksum) {
          this.logger?.event(
            "migrate:warn",
            `checksum drift on already-applied migration "${stem}" — file may have been edited after apply`
          );
        }
        continue;
      }

      const content = await readFile(file, "utf8");
      const checksum = sha256(content);

      if (opts.dryRun) {
        results.push({ name: stem, success: true, dryRun: true, sql: content });
        continue;
      }

      try {
        await this.db.sql.begin(async (sql) => {
          await sql.unsafe(content);
        });
        await this.db.recordMigration(stem, checksum);
        this.logger?.event("migrate:apply", `✓ ${stem}`);
        results.push({ name: stem, success: true });
      } catch (error) {
        const errMsg = String(error);
        this.logger?.event("migrate:error", `✗ ${stem}: ${errMsg}`);
        results.push({ name: stem, success: false, error: errMsg });
        throw new Error(`[lumora] Migration "${stem}" failed: ${errMsg}`);
      }
    }

    return results;
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  /**
   * Discover all *.sql files in the migrations directory,
   * sorted lexicographically (date-prefix guarantees chronological order).
   */
  private async discoverFiles(): Promise<string[]> {
    const dir = this.config.migrations.dir;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      // Migrations directory does not exist — treat as empty (first boot with no migrations)
      return [];
    }
    return entries
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => path.join(dir, f));
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
