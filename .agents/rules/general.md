# Lumora Server - Monorepo General Development Rules

This catalog defines general monorepo conventions for validation and releases.

## General Repository Hard Rules

| ID | Rule | Violation |
|---|---|---|
| G1 | **Conventional Commits Only** | Commits MUST use standard conventional syntax (e.g., `feat:`, `fix:`, `docs:`, `chore:`). Commits that violate this break the changelog generation script. |
| G2 | **Pre-Commit Verification** | Run the complete verification checklist (`bun run check`, `bun test`, `bun run build`) before making PRs or declaring a task complete. |
| G3 | **Release Automation** | Do NOT create NPM packages or GitHub releases manually. Bump the `VERSION` file, run `bun run release:prep`, commit, and let the CI pipeline publish. |
| G4 | **Branch-First for DB/CI/Test Changes** | Any commit that touches `packages/core/src/db.ts`, any `pg-*.test.ts`, or any `.github/workflows/*.yml` MUST be on a feature/fix branch. The branch must pass CI (green `ci.yml`) before it is merged to `main`. Direct pushes to `main` for these files are prohibited. |
| G5 | **Full Local Suite Before Branch Push** | Before pushing any branch, run `bun test` locally. If PostgreSQL is configured via `.env`, all 118 tests must pass. If not configured, 113 non-pg tests must pass and the remaining 5 are expected to fail with connection refused. Never push with unexpected test failures. |
