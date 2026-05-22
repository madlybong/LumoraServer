# Security Policy

## Supported Versions

Only the latest release series of `@astrake/lumora-server` receives security fixes.

| Version | Supported |
|---------|-----------|
| v0.2.x  | ✅ (Latest) |
| < v0.2.0 | ❌ (Legacy) |

> [!NOTE]
> Major security patches and protocol hardening (such as mandatory server-side JWT expiration `exp` validation, safe `hidden` field data stripping, and explicit RBAC authorization) are built natively into version `v0.2.x` and later. Older legacy versions (e.g. `0.1.7`) are deprecated and no longer supported.

## Reporting a Vulnerability

**Please do not report security vulnerabilities via public GitHub issues.**

If you discover a security vulnerability in `@astrake/lumora-server`, please disclose it
responsibly by opening a [GitHub Security Advisory](https://github.com/madlybong/LumoraServer/security/advisories/new)
or reaching out directly via the author's GitHub profile at https://github.com/madlybong.

### What to include

- A clear description of the vulnerability and its potential impact.
- Steps to reproduce the issue or a minimal proof-of-concept.
- Any suggested mitigations or fixes, if known.

### Response timeline

- **Acknowledgement:** within 72 hours of a valid report.
- **Status update:** within 14 days.
- **Resolution target:** within 90 days, depending on severity and complexity.

## Disclosure Policy

This project follows a **coordinated disclosure** model. Public disclosure of the
vulnerability details will be made only after a fix has been released, or after the
90-day deadline has elapsed — whichever comes first.

## No Bounty Program

This is a personal open-source project maintained by a single author. There is no
bug bounty program. Responsible reporters will be credited in the release notes.

## Disclaimer

`@astrake/lumora-server` is provided "as is" without warranty of any kind.
The author accepts no liability for security incidents arising from the use of this
software. See [docs/LEGAL.md](./docs/LEGAL.md) for the full disclaimer.
