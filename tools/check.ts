import path from "node:path";

const projects = [
  "packages/core/tsconfig.json",
  "apps/starter/tsconfig.json"
];

const tscBinary = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsc.exe" : "tsc"
);

for (const project of projects) {
  const proc = Bun.spawn([tscBinary, "-p", project], {
    stdout: "inherit",
    stderr: "inherit"
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.exit(code);
  }
}

console.log(`Checked ${projects.length} TypeScript projects.`);
