# Contributing to X-agent

Thanks for your interest in X-agent! This document explains how to file
issues, send changes, and follow the maintainer's lightweight workflow.
It is meant for **individual contributors and small teams** — X-agent is a
single-maintainer project, so we keep the process small.

For the project's overall architecture, Agent/Session internals, and
conventions, see:

- [`CLAUDE.md`](CLAUDE.md) — engineering conventions (Chinese)
- [`AGENTS.md`](AGENTS.md) — Agent entry-point guidance
- [`CONTEXT.md`](CONTEXT.md) — domain glossary and design notes
- [`DESIGN.md`](DESIGN.md) — UI/design tokens

For the maintenance cadence, see [`MAINTENANCE.md`](MAINTENANCE.md).

## Quick Checklist

- [ ] Discuss the change in an Issue first (use the templates)
- [ ] Branch off `master`: `feat/<scope>` / `fix/<scope>` / `docs/<scope>` / `chore/<scope>`
- [ ] Follow [Conventional Commits](#commit-message-format)
- [ ] Keep PRs small (1 Issue → 1 PR, ideally 1-3 days of work)
- [ ] Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md)
- [ ] All CI jobs green: `desktop` / `unit-test` / `e2e` / `actionlint`
- [ ] Self-review before requesting review

## Code of Conduct

All participants are expected to follow
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Reports go to
[fromlan@qq.com](mailto:fromlan@qq.com).

## Filing an Issue

Three templates are available under
[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE):

- **Bug report** — something is broken; fill in repro steps, expected vs
  actual, environment (X-agent version / Godot version / model / OS)
- **Feature request** — describe the problem first, then a proposed solution
  and alternatives
- **Question** — usage questions; please skim the README and
  [`CHANGELOG.md`](CHANGELOG.md) first

Issues are auto-labelled by keywords in the title/body. The maintainer runs
a weekly triage pass — be patient if it takes a few days.

## Branching

We use a trunk-based flow (GitHub Flow):

- `master` is always green
- Short-lived branches named `<type>/<scope>`:
  - `feat/<scope>` — new user-facing capability
  - `fix/<scope>` — bug fix
  - `docs/<scope>` — documentation only
  - `chore/<scope>` — tooling / housekeeping
- After the first PR is merged, delete the branch

## Commit Message Format

This project uses [Conventional Commits 1.0.0](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

Allowed `<type>` values:

| Type       | When                                                |
|------------|-----------------------------------------------------|
| `feat`     | New user-facing feature                             |
| `fix`      | Bug fix                                             |
| `docs`     | Documentation only                                  |
| `chore`    | Tooling, refactors with no user impact              |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test`     | Add/fix tests only                                  |
| `perf`     | Performance improvement                             |
| `build`    | Build system / dependency changes                   |
| `ci`       | CI workflow changes                                 |
| `style`    | Formatting only (no logic change)                   |
| `release`  | Version bump (driven by `prepare-release.mjs`)      |

`<scope>` is optional but encouraged. Examples: `gui`, `godot-rpc`, `plan-mode`,
`i18n`, `docs`. `<subject>` uses imperative mood, no trailing period, ≤ 72
chars on the first line.

A pre-commit hook (`scripts/commit-author-guard.sh`) and a commit-msg hook
(`scripts/commit-msg-lint.mjs`) enforce author identity and message format
locally. To install them, run the setup in
[`MAINTENANCE.md`](MAINTENANCE.md).

## Pull Requests

1. Push your branch and open a PR against `master`
2. Fill in `.github/PULL_REQUEST_TEMPLATE.md`
3. Reference the related Issue with `Fixes #123` or `Refs #123`
4. Wait for CI: `desktop` (typecheck + lint + test + build), `unit-test`
   (Vitest coverage gate), `e2e` (Playwright), `actionlint` (workflow YAML)
5. The maintainer will self-review and merge

If your PR changes user-facing behavior, also add an entry under `## Unreleased`
in [`CHANGELOG.md`](CHANGELOG.md).

## Testing Locally

From `apps/desktop` (lock file lives there):

```bash
cd apps/desktop
npm install
npm run typecheck
npm test           # offline assertion scripts (no auth needed)
npm run test:unit  # Vitest with coverage gate
npm run test:e2e   # Playwright (requires `npm run build` first)
```

Real-model smoke tests need a Pi auth in `~/.pi/agent/auth.json` — they are
**not** part of CI.

## Local Development Setup

```bash
# 1. Install dependencies
cd apps/desktop && npm install && cd ..

# 2. Install pre-commit / commit-msg hooks
git config core.hooksPath scripts/git-hooks

# 3. Run dev mode
npm run desktop:dev
```

## Reporting Security Issues

Please see [`SECURITY.md`](SECURITY.md). Do **not** open public issues for
security-sensitive reports.

## Release Process

See [`MAINTENANCE.md`](MAINTENANCE.md#release-cadence). The short version:

1. Update `## Unreleased` in `CHANGELOG.md`
2. `npm run release:prepare -- 0.6.0` (validates the changelog, bumps
   `apps/desktop/package.json` + lockfile)
3. Commit, push, `git tag v0.6.0 && git push origin v0.6.0`
4. `release.yml` builds the Windows installer and uploads to GitHub Releases

## Reviewer Policy

X-agent is currently maintained by a single maintainer (`@fromlan`). External
reviewers are welcome; assign yourself if you want a self-review pass before
the maintainer picks it up.
