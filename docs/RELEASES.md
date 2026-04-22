# Releases

## Version source of truth

Lumora now uses the root [`VERSION`](../VERSION) file as the centralized version source.

The following files are synchronized from it:

- [`package.json`](../package.json)
- [`packages/core/package.json`](../packages/core/package.json)

Run:

```bash
bun run version:sync
```

To verify the repo is version-clean:

```bash
bun run version:check
```

## Git workflows

The repo includes GitHub Actions workflows for:

- CI on pushes and pull requests
- version consistency checks
- release packaging and publish-ready npm workflow on tags like `v0.1.0`

## npm registry setup

The package is configured for the public npm registry:

- registry: `https://registry.npmjs.org/`
- package: `@astrake/lumora`
- publish access: `public`

Repository publishing expects:

- GitHub Actions secret: `NPM_TOKEN`
- optional local login via `npm login --registry=https://registry.npmjs.org/`

The repo-level [`.npmrc`](../.npmrc) and package `publishConfig` both point to npmjs.

## Release flow

1. Update [`VERSION`](../VERSION)
2. Run `bun run version:sync`
3. Run `bun run check`
4. Run `bun test`
5. Run `bun run build`
6. Commit the version bump
7. Tag the release as `vX.Y.Z`
8. Push branch and tag

The release workflow will build, test, create a package artifact, and publish if `NPM_TOKEN` is configured.
