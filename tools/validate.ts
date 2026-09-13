import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = process.cwd();

const steps = [
  { name: "Typecheck (check)", cmd: ["bun", "run", "./tools/check.ts"] },
  { name: "Tests (test)", cmd: ["bun", "test"] },
  { name: "Build (build)", cmd: ["bun", "run", "./tools/build.ts"] },
  { name: "Version Sync (version:sync)", cmd: ["bun", "run", "version:sync"] }
];

console.log("=========================================");
console.log("🚀 Starting Lumora Validation Pipeline...");
console.log("=========================================\n");

let failed = false;

for (const step of steps) {
  console.log(`\n▶️ Running: ${step.name}`);
  const [command, ...args] = step.cmd;
  
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    console.error(`\n❌ Step Failed: ${step.name} (exit code: ${result.status})`);
    failed = true;
    break;
  }
  
  console.log(`✅ Step Passed: ${step.name}`);
}

if (failed) {
  console.error("\n❌ Validation Pipeline Failed. Please fix the errors above before releasing.");
  process.exit(1);
} else {
  console.log("\n✅ All validation steps passed! Ready for release.");
  process.exit(0);
}
