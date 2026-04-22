import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const versionFile = path.join(root, "VERSION");
const rootPackageFile = path.join(root, "package.json");
const frameworkPackageFile = path.join(root, "packages", "core", "package.json");

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

async function main() {
  const version = normalizeVersion(await readFile(versionFile, "utf8"));
  const rootPackage = await readJson<Record<string, unknown>>(rootPackageFile);
  const frameworkPackage = await readJson<Record<string, unknown>>(frameworkPackageFile);

  rootPackage.version = version;
  frameworkPackage.version = version;

  await writeJson(rootPackageFile, rootPackage);
  await writeJson(frameworkPackageFile, frameworkPackage);

  console.log(`Synchronized root and package versions to ${version}`);
}

await main();
