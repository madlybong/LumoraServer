import { rmSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const tscBinary = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsc.exe" : "tsc"
);

// 1. Build packages/core
const coreDir = path.join(rootDir, "packages/core");
try {
  rmSync(path.join(coreDir, "dist"), { recursive: true, force: true });
} catch {}

const tscProc = Bun.spawn([tscBinary, "-p", "tsconfig.build.json"], {
  cwd: coreDir,
  stdout: "inherit",
  stderr: "inherit"
});
const tscCode = await tscProc.exited;
if (tscCode !== 0) {
  process.exit(tscCode);
}

const coreBuild = Bun.spawn(
  [process.execPath, "build", "./src/index.ts", "./bin/init.ts", "--outdir", "./dist", "--target", "bun", "--packages", "external"],
  {
    cwd: coreDir,
    stdout: "inherit",
    stderr: "inherit"
  }
);
const coreCode = await coreBuild.exited;
if (coreCode !== 0) {
  process.exit(coreCode);
}

// 2. Build apps/starter
const starterDir = path.join(rootDir, "apps/starter");
const starterBuild = Bun.spawn(
  [process.execPath, "build", "./src/index.ts", "--outdir", "./dist", "--target", "bun", "--packages", "external"],
  {
    cwd: starterDir,
    stdout: "inherit",
    stderr: "inherit"
  }
);
const starterCode = await starterBuild.exited;
if (starterCode !== 0) {
  process.exit(starterCode);
}

console.log("Built 2 projects.");
