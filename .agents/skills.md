# Lumora Server - Agentic Skills Playbook

This playbook encodes institutional knowledge to prevent repeating past mistakes. Use these step-by-step skills for complex recurring tasks.

## Skill 1 — `add-bun-native-api`
**Trigger:** Any time you are about to write code that calls `new SQL(...)`, `Bun.password.*`, `Bun.serve(...)`, or any `bun:*` namespace.
**Steps (mandatory):**
1. Open `node_modules/bun-types/` and find the relevant `.d.ts` file.
2. Read the full function/constructor signature including all parameter types.
3. Check for deprecated fields (marked `@deprecated`). Note which fields are `readonly` vs configurable.
4. Write the code using only the documented API surface.
5. Run `bun run check`. Fix any errors before continuing.
6. Never use `as any` to bypass a type error — that hides the real bug.

## Skill 2 — `add-postgresql-feature`
**Trigger:** Any change to `packages/core/src/db.ts` that affects the PostgreSQL path.
**Steps:**
1. **Read `sql.d.ts` first.** Specifically `PostgresOrMySQLOptions` and the `SQL` class constructor overloads.
2. **Check three-client parity.** Your change must not break SQLite or MySQL behavior. Add a comment explaining which client(s) are affected.
3. **Check rule D2.** All dialect-specific SQL must stay inside `db.ts`.
4. **Write the feature code** using only verified API from step 1.
5. **Run `bun run check` and `bun run build`.** Fix immediately if any errors.
6. **Create a branch** (e.g., `feat/pg-my-feature`). Do NOT commit to `main` yet.
7. **Run `bun test` locally:**
   - If `.env` with `TEST_PG_URL` is configured → all 118 tests must pass.
   - If no local PG → 113 non-pg tests must pass; 5 pg tests fail with connection refused (expected).
8. **Push branch and open a PR.** Wait for GitHub Actions CI to go fully green.
9. **Only then merge to `main`** and follow the release skill.

## Skill 3 — `release-safely`
**Trigger:** When all feature work is done, CI is green on the PR, and it's time to publish.
**Prerequisites:**
- [ ] PR branch is fully green on GitHub Actions.
- [ ] PR merged into `main`.
- [ ] `git status` shows a clean tree on `main`.

**Steps:**
1. `git checkout main && git pull origin main`
2. Edit `VERSION` file — increment appropriately.
3. `bun run release:prep`
4. Review the generated `CHANGELOG.md`.
5. `bun run check` and `bun run build`.
6. `bun run version:check` (verifies no dirty tree from uncommitted changes).
7. `git add VERSION package.json apps/starter/package.json packages/core/package.json CHANGELOG.md`
8. `git commit -m "chore(release): bump version to X.Y.Z"`
9. `git push origin main`
*(GitHub Actions `release.yml` handles tagging and npm publish automatically).*

**Never:**
- Do not run `npm publish` manually.
- Do not push a release commit if check or build fails.

## Skill 4 — `write-integration-test`
**Trigger:** Writing a new test in `pg-*.test.ts` that requires a real PostgreSQL database.
**Rules:**
1. **Use `pg.config.ts`** — always import the config, never hardcode connection strings.
2. **Schema is `lumora_test_schema`** — all test DDL goes inside this schema. Clean up in `afterAll`.
3. **Uncertain output? Be flexible first:** When asserting raw database output, use `.toContain()` or `.toBeDefined()` on the first draft. Push a branch, let CI run, and read the CI log to learn the exact output format before tightening to `.toBe()`.
4. **Clean up teardown:** Every test must have an `afterAll` or `afterEach` that removes its tables/rows.
5. **CI vs local:** CI uses service containers. Local uses `.env`. If `.env` is missing, connection failures are expected.

## Skill 5 — `debug-ci-failure`
**Trigger:** GitHub Actions shows a failed check on a PR or `main` push.
**Step 1:** Read the failure summary in the step output (not just the job summary).
**Step 2:** Classify the error (e.g., TS error → read `bun-types`; test assertion → read "received" value).
**Step 3:** Fix locally, not in CI. Never commit a "try this" fix and push to see if CI accepts it.
**Step 4:** Use a branch. If the fix involves db.ts or workflows, follow the PR flow.
