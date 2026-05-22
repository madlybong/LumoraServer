# Lumora Server - Monorepo General Development Rules

This catalog defines general monorepo conventions for validation and releases.

## General Repository Hard Rules

| ID | Rule | Violation |
|---|---|---|
| G1 | **Conventional Commits Only** | Commits MUST use standard conventional syntax (e.g., `feat:`, `fix:`, `docs:`, `chore:`). Commits that violate this break the changelog generation script. |
| G2 | **Pre-Commit Verification** | Run the complete verification checklist (`bun run check`, `bun test`, `bun run build`) before making PRs or declaring a task complete. |
| G3 | **Release Automation** | Do NOT create NPM packages or GitHub releases manually. Bump the `VERSION` file, run `bun run release:prep`, commit, and let the CI pipeline publish. |
