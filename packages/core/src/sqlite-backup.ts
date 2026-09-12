import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function backupSqliteDatabase(url: string, logger?: { event: (cat: string, msg: string) => void }): Promise<string | undefined> {
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
    
    await copyFile(dbPath, backupPath);
    
    // Attempt to copy WAL/SHM files if they exist (ignoring errors if not)
    try { await copyFile(`${dbPath}-wal`, `${backupPath}-wal`); } catch {}
    try { await copyFile(`${dbPath}-shm`, `${backupPath}-shm`); } catch {}

    logger?.event("backup", `SQLite database backed up to ${backupPath}`);
    return backupPath;
  } catch (err) {
    logger?.event("error", `Failed to backup SQLite database: ${err}`);
    throw err;
  }
}
