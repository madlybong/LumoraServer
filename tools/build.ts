const builds: Array<[string, string[]]> = [
  ["packages/core", ["bun", "build", "./src/index.ts", "./bin/init.ts", "--target", "bun", "--outdir", "./dist"]],
  ["apps/starter", ["bun", "build", "./src/index.ts", "--target", "bun", "--outdir", "./dist"]]
];

for (const [cwd, command] of builds) {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit"
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.exit(code);
  }
}

console.log(`Built ${builds.length} projects.`);
