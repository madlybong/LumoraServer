# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows a simple versioned release flow driven by the root `VERSION` file.

## [0.1.0] - 2026-04-23

### Added

- Initial git repository setup on `main`
- Centralized version management via `VERSION`
- GitHub Actions workflows for CI, version consistency, and release publishing
- Slim `@astrake/lumora` framework runtime built around:
  - `defineLumoraConfig(...)`
  - `defineResource(...)`
  - `initLumora(...)`
- File-based resource discovery with generated CRUD REST endpoints
- Generated SSE and WebSocket endpoints per resource
- Typed lifecycle, realtime, and DB transaction event emission
- Dev-mode OpenAPI document generation and docs UI
- Interactive init wizard for `bunx init @astrake/lumora`
- Reference starter app using `lumora.config.ts` and `routes/*.ts`
- Documentation set for project overview, architecture, development, releases, roadmap, and AI agent guidance

### Changed

- Refactored the earlier thicker framework direction into a slimmer single-package runtime model
- Cleaned the repository down to the active framework package, starter app, tools, and docs

### Removed

- Old inactive package structure and related stale artifacts from the previous scaffold direction
