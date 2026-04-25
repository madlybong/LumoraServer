/**
 * changelog.ts
 *
 * Automated changelog generator for @astrake/lumora-server.
 * Reads VERSION, inspects git log since the last tag, groups commits
 * by conventional-commit prefix, and prepends a new section to CHANGELOG.md.
 *
 * Usage:  bun run ./tools/changelog.ts
 * Requires: git on PATH, a VERSION file in the repo root.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function run(cmd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Commit grouping ──────────────────────────────────────────────────────────

type Group =
  | "breaking"
  | "feat"
  | "fix"
  | "perf"
  | "docs"
  | "maintenance"
  | "other";

const GROUP_LABELS: Record<Group, string> = {
  breaking: "⚠ Breaking Changes",
  feat: "Added",
  fix: "Fixed",
  perf: "Changed",
  docs: "Documentation",
  maintenance: "Maintenance",
  other: "Other",
};

function classify(subject: string): Group {
  if (/BREAKING[- ]CHANGE/i.test(subject)) return "breaking";
  if (/^feat(\(.+\))?!?:/.test(subject)) return "feat";
  if (/^fix(\(.+\))?!?:/.test(subject)) return "fix";
  if (/^(perf|refactor)(\(.+\))?!?:/.test(subject)) return "perf";
  if (/^docs(\(.+\))?!?:/.test(subject)) return "docs";
  if (/^(chore|ci|build|test|style)(\(.+\))?!?:/.test(subject))
    return "maintenance";
  return "other";
}

function stripPrefix(subject: string): string {
  return subject.replace(/^[a-z]+(\(.+\))?!?:\s*/i, "").trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Read version
  const version = (await readFile(path.join(root, "VERSION"), "utf8")).trim();
  console.log(`\nGenerating changelog for v${version}...\n`);

  // 2. Find last tag (gracefully handle first release with no tags)
  let lastTag: string | null = null;
  try {
    lastTag = await run("git", ["describe", "--tags", "--abbrev=0"]);
  } catch {
    lastTag = null;
  }

  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const rangeLabel = lastTag ? `${lastTag}..HEAD` : "initial commit..HEAD";
  console.log(`  Scanning commits: ${rangeLabel}`);

  // 3. Collect commits
  const raw = await run("git", [
    "log",
    range,
    "--pretty=format:%s|%h",
    "--no-merges",
  ]);

  const lines = raw ? raw.split("\n").filter(Boolean) : [];
  console.log(`  Found ${lines.length} commit(s)\n`);

  // 4. Group by type
  const groups: Record<Group, string[]> = {
    breaking: [],
    feat: [],
    fix: [],
    perf: [],
    docs: [],
    maintenance: [],
    other: [],
  };

  for (const line of lines) {
    const [subject, hash] = line.split("|");
    const group = classify(subject ?? "");
    const clean = stripPrefix(subject ?? "");
    groups[group].push(`- ${clean} (\`${hash}\`)`);
  }

  // 5. Build section
  const sectionLines: string[] = [
    `## [${version}] — ${today()}`,
    "",
  ];

  const order: Group[] = [
    "breaking",
    "feat",
    "fix",
    "perf",
    "docs",
    "maintenance",
    "other",
  ];

  for (const key of order) {
    if (groups[key].length === 0) continue;
    sectionLines.push(`### ${GROUP_LABELS[key]}`);
    sectionLines.push("");
    sectionLines.push(...groups[key]);
    sectionLines.push("");
  }

  if (sectionLines.length === 2) {
    sectionLines.push("_No conventional commits found in this range._");
    sectionLines.push("");
  }

  const section = sectionLines.join("\n");

  // 6. Prepend to CHANGELOG.md
  const changelogPath = path.join(root, "CHANGELOG.md");
  let existing = "";
  try {
    existing = await readFile(changelogPath, "utf8");
  } catch {
    existing =
      "# Changelog\n\nAll notable changes are documented here.\n" +
      "Format: [Keep a Changelog](https://keepachangelog.com/) · " +
      "Commits: [Conventional Commits](https://www.conventionalcommits.org/)\n\n";
  }

  // Replace or prepend the Unreleased section
  const withoutUnreleased = existing.replace(
    /## Unreleased\n[\s\S]*?(?=\n## \[|\n---|\s*$)/,
    ""
  );

  // Insert after the header block (first two lines)
  const headerEnd = withoutUnreleased.indexOf("\n\n");
  const header =
    headerEnd !== -1 ? withoutUnreleased.slice(0, headerEnd + 2) : "";
  const rest =
    headerEnd !== -1 ? withoutUnreleased.slice(headerEnd + 2) : withoutUnreleased;

  const newContent = `${header}## Unreleased\n\n---\n\n${section}\n${rest}`;
  await writeFile(changelogPath, newContent);

  console.log(`  ✓ CHANGELOG.md updated\n`);
  console.log("─".repeat(60));
  console.log(section);
}

await main();
