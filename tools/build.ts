const builds: Array<[string, string[]]> = [
  ["packages/core", ["bun", "run", "build"]],
  ["apps/starter", ["bun", "run", "build"]]
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
