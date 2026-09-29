# Governance

CLIPLINK is a single-maintainer project. This file says who decides what, how
changes get in, and what happens if the maintainer stops.

## Roles

| Role | Who | Responsibilities |
| --- | --- | --- |
| Maintainer | [@thebkht](https://github.com/thebkht) | Triages issues; reviews and merges pull requests; cuts npm and GitHub releases; answers security reports under [SECURITY.md](SECURITY.md); runs the deployment at cliplink.thebkht.com; administers the repository, the `@thebkht` npm scope and the domain; enforces the [Code of Conduct](CODE_OF_CONDUCT.md). |
| Contributor | Anyone who opens an issue or pull request | Follows [CONTRIBUTING.md](CONTRIBUTING.md) and the Code of Conduct. |

The maintainer is the code owner for every path ([`.github/CODEOWNERS`](.github/CODEOWNERS)).

## How decisions are made

- **Changes** land through pull requests to `main`. CI (tests, lint, type-check, build, CodeQL, dependency review) must pass first. The maintainer decides whether to merge.
- **Direction** is discussed in issues. The maintainer decides and records the reason in the thread. The [roadmap](README.md#roadmap) lists what is planned and what is deliberately left out.
- **The wire protocols are fixed.** Wire protocol v1 in [`@thebkht/cliplink`](packages/cliplink) and in [`@thebkht/rtc-file-transfer`](packages/rtc-file-transfer) cannot change incompatibly, whatever the proposal, because deployed clients depend on it. See CONTRIBUTING.md.
- **Releases** follow semver for the packages. They publish from a tag through a protected environment that needs the maintainer's approval.
- **Security reports** go through a private GitHub Security Advisory, never a public issue. They are handled as SECURITY.md describes.

## Becoming a maintainer

Someone with a record of merged, reviewed contributions may be invited to become a maintainer. Maintainers get merge and release rights, and this file is updated to list them.

## Continuity

The project currently has one maintainer, so its bus factor is 1. If the maintainer is unavailable:

- The code is MIT-licensed and public. Anyone can fork it and keep it going.
- The packages are published with npm provenance. A fork can publish under its own scope, and users can tell the builds apart.
- The deployment is a stock Next.js build that runs without credentials, per README "Self-hosting". Nothing needed to run it is held privately.

What a fork cannot inherit today is the repository, the npm scope and the domain. Giving a second person access to those is an open item.
