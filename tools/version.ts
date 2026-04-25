import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const versionFile = path.join(root, "VERSION");
const rootPackageFile = path.join(root, "package.json");
const corePackageFile = path.join(root, "packages", "core", "package.json");
const starterPackageFile = path.join(root, "apps", "starter", "package.json");

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeVersion(version: string): string {
  const normalized = version.trim();
  if (!/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid VERSION value: ${normalized}`);
  }
  return normalized;
}

async function patchVersion(
  file: string,
  version: string,
  label: string
): Promise<void> {
  try {
    const pkg = await readJson<Record<string, unknown>>(file);
    if ("version" in pkg) {
      pkg.version = version;
      await writeJson(file, pkg);
      console.log(`  ✓ ${label} → ${version}`);
    } else {
      console.log(`  – ${label} has no version field, skipped`);
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(`  – ${label} not found, skipped`);
    } else {
      throw err;
    }
  }
}

async function main() {
  const version = normalizeVersion(await readFile(versionFile, "utf8"));
  console.log(`\nSyncing version ${version} across all packages...\n`);
  await patchVersion(rootPackageFile, version, "root package.json");
  await patchVersion(corePackageFile, version, "packages/core/package.json");
  await patchVersion(starterPackageFile, version, "apps/starter/package.json");
  console.log("\nDone.\n");
}

await main();
