#!/usr/bin/env bun
/**
 * Lumora CLI — multi-command dispatcher
 *
 * Usage:
 *   lumora                         — show help
 *   lumora init                    — interactive project scaffolding wizard
 *   lumora migrate                 — apply all pending migrations (production deploy step)
 *   lumora migrate --status        — show applied/pending migration list
 *   lumora migrate --dry-run       — print SQL without applying
 */

import path from "node:path";
import { runInitWizard } from "../src/init-wizard";
import { LumoraMigrationEngine } from "../src/migrations";
import { LumoraDatabase } from "../src/db";
import { loadLumoraConfig } from "../src/config";
import { LumoraEventEmitter } from "../src/events";
import type { LumoraEventMap } from "../src/types";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

switch (command) {
  case "init":
    await runInitWizard();
    break;

  case "migrate":
    await runMigrate(args.slice(1));
    break;

  default:
    printHelp();
    break;
}

// ─── migrate ────────────────────────────────────────────────────────────────

async function runMigrate(flags: string[]): Promise<void> {
  const isStatus = flags.includes("--status");
  const isDryRun = flags.includes("--dry-run");

  const { db, config } = await connectFromCwd();

  try {
    const engine = new LumoraMigrationEngine(db, config);

    if (isStatus) {
      const { applied, pending } = await engine.status();
      console.log("\nApplied migrations:");
      if (applied.length === 0) {
        console.log("  (none)");
      } else {
        for (const m of applied) {
          console.log(`  ✓ ${m.name}  [${m.applied_at}]`);
        }
      }
      console.log("\nPending migrations:");
      if (pending.length === 0) {
        console.log("  (none — database is up to date)");
      } else {
        for (const name of pending) {
          console.log(`  • ${name}`);
        }
        process.exit(1); // non-zero so CI knows there are pending migrations
      }
      return;
    }

    if (isDryRun) {
      console.log("\n[dry-run] Migrations that would be applied:\n");
      const results = await engine.applyPending({ dryRun: true });
      if (results.length === 0) {
        console.log("  (none — database is up to date)");
      } else {
        for (const r of results) {
          console.log(`\n── ${r.name} ──\n${r.sql}`);
        }
      }
      return;
    }

    // Default: apply all pending
    const results = await engine.applyPending();
    if (results.length === 0) {
      console.log("No pending migrations — database is up to date.");
    } else {
      console.log(`\nApplied ${results.length} migration(s) successfully.`);
    }
  } finally {
    await db.close();
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function connectFromCwd(): Promise<{
  db: LumoraDatabase;
  config: Awaited<ReturnType<typeof loadLumoraConfig>>;
}> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "lumora.config.ts");

  let config: Awaited<ReturnType<typeof loadLumoraConfig>>;
  try {
    config = await loadLumoraConfig(configPath, cwd);
  } catch (err) {
    console.error(`Could not load lumora.config.ts from ${cwd}:\n  ${String(err)}`);
    console.error("\nMake sure you are running this command from your project root.");
    process.exit(1);
  }

  const events = new LumoraEventEmitter<LumoraEventMap>();
  const db = new LumoraDatabase(config.database, events);
  await db.connect();
  return { db, config };
}

function printHelp(): void {
  console.log(`
Lumora CLI

Usage:
  lumora init                       Interactive project scaffolding
  lumora migrate                    Apply all pending migrations  (production pre-deploy)
  lumora migrate --status           Show applied / pending migrations
  lumora migrate --dry-run          Print SQL without applying

Run commands from your project root (where lumora.config.ts lives).
`);
}
