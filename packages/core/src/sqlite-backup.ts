import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

export interface SqliteBackupOptions {
  sql?: import("bun").SQL;
  maxRetainedBackups?: number;
}

export async function backupSqliteDatabase(
  url: string,
  logger?: { event: (cat: string, msg: string) => void },
  options?: SqliteBackupOptions
): Promise<string | undefined> {
  let dbPath = url;
  if (dbPath.startsWith("sqlite://")) {
    dbPath = dbPath.slice(9);
  }

  if (dbPath === ":memory:" || !dbPath) {
    return undefined;
  }

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = path.extname(dbPath) || ".sqlite";
    const name = path.basename(dbPath, ext);
    const targetDir = path.dirname(dbPath);

    await mkdir(targetDir, { recursive: true });
    const backupPath = path.join(targetDir, `${name}_backup_${timestamp}${ext}`);

    let vacuumSucceeded = false;
    if (options?.sql) {
      try {
        try { await unlink(backupPath); } catch {}
        const escapedBackup = backupPath.replace(/'/g, "''");
        await options.sql.unsafe(`VACUUM INTO '${escapedBackup}'`);
        vacuumSucceeded = true;
      } catch {
        vacuumSucceeded = false;
      }
    }

    if (!vacuumSucceeded) {
      await copyFile(dbPath, backupPath);
      try { await copyFile(`${dbPath}-wal`, `${backupPath}-wal`); } catch {}
      try { await copyFile(`${dbPath}-shm`, `${backupPath}-shm`); } catch {}
    }

    if (options?.maxRetainedBackups !== undefined && options.maxRetainedBackups > 0) {
      try {
        const entries = await readdir(targetDir);
        const prefix = `${name}_backup_`;
        const backups = entries
          .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
          .sort();
        while (backups.length > options.maxRetainedBackups) {
          const oldest = backups.shift()!;
          const oldestFull = path.join(targetDir, oldest);
          try { await unlink(oldestFull); } catch {}
          try { await unlink(`${oldestFull}-wal`); } catch {}
          try { await unlink(`${oldestFull}-shm`); } catch {}
        }
      } catch {}
    }

    logger?.event("backup", `SQLite database backed up to ${backupPath}`);
    return backupPath;
  } catch (err) {
    logger?.event("error", `Failed to backup SQLite database: ${err}`);
    throw err;
  }
}

export async function restoreSqliteBackup(
  url: string,
  backupPath: string,
  logger?: { event: (cat: string, msg: string) => void }
): Promise<void> {
  let dbPath = url;
  if (dbPath.startsWith("sqlite://")) {
    dbPath = dbPath.slice(9);
  }
  if (dbPath === ":memory:" || !dbPath) return;

  await copyFile(backupPath, dbPath);
  try { await unlink(`${dbPath}-wal`); } catch {}
  try { await unlink(`${dbPath}-shm`); } catch {}
  try { await copyFile(`${backupPath}-wal`, `${dbPath}-wal`); } catch {}
  try { await copyFile(`${backupPath}-shm`, `${dbPath}-shm`); } catch {}
  logger?.event("backup:restore", `SQLite database restored from ${backupPath}`);
}
