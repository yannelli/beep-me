# Contributing

Thanks for helping. This file covers setup, the commit format, and how releases work.

## Setup

Use Node.js 24 or later (`.nvmrc` pins 24) and [Bun](https://bun.sh) 1.2 or later. Bun installs the packages and runs the scripts. Vite and Wrangler run on Node.js.

```sh
bun install
cp .dev.vars.example .dev.vars   # set APP_SECRET to 32+ random characters
bun run dev                       # http://localhost:5173
```

On localhost, **Continue as developer** signs you in without Google. [AGENTS.md](AGENTS.md) explains the layout and the rules for code, copy, and docs.

## Before you open a pull request

```sh
bun run typecheck
bun run check:docs
bun run build
```

All three must pass. When you change behavior, update the docs page that describes it in `src/web/docs/content/`. See [docs/docs-site.md](docs/docs-site.md).

## Branches

`main` is the default branch and holds releases. Create feature branches from `main` and open pull requests against `main`.

## Commit and PR format

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit subjects and PR titles:

```text
fix(telegram): recreate a deleted topic thread
feat(channels): add a Matrix channel
feat(api)!: rename the dedupe_key field
```

Keep subjects within 72 characters. Use an imperative description without a trailing period. PR bodies describe the changed behavior, how you checked it, and migration steps for breaking changes.

## Versions

Versions follow [Semantic Versioning](https://semver.org/). Tags are `vX.Y.Z`.

| Commit | Release |
| --- | --- |
| `fix`, `perf`, `revert` | Patch: `0.1.0` → `0.1.1` |
| `feat` | Minor: `0.1.0` → `0.2.0` |
| Any type with `!` or a `BREAKING CHANGE:` footer | Major: `0.1.0` → `1.0.0` |
| `docs`, `chore`, `ci`, `build`, `refactor`, `style`, `test` | No release without a breaking marker |

The highest bump among unreleased commits wins. The major-bump policy also applies before `1.0.0`.

The compatibility surface includes the MCP tools and their fields, the REST API, the webhook payload and signature, environment variables, `wrangler.jsonc` bindings, and the database schema.

## Releases

The maintainer releases from a clean checkout of the latest `origin/main` (any branch or worktree):

```sh
bun run release --dry-run     # show the next version and notes
bun run release               # bump package.json, update CHANGELOG.md, tag, push, publish the GitHub release
```

`scripts/release.mjs` reads the commits since the latest `vX.Y.Z` tag, picks the bump from the table above, and stops when no commit calls for a release. It needs the GitHub CLI (`gh`) signed in.
