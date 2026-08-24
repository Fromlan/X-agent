# Maintenance Cadence

X-agent is a single-maintainer project. This document records the **light
rituals** that keep the repository healthy. It is not a Scrum / Kanban plan;
it is "the things the maintainer does on a clock".

> See also [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contributor-facing
> workflow, and [`CLAUDE.md`](CLAUDE.md) for engineering conventions.

## At a Glance

| Cadence   | Time   | Action                                                         | Tool / File                              |
|-----------|--------|----------------------------------------------------------------|------------------------------------------|
| Weekly    | 30 min | Issue triage: label / milestone / close stale                  | GitHub Issues + `.github/labels.yml`     |
| Weekly    | 15 min | Dependabot PR sweep: merge trivial, escalate big               | `.github/dependabot.yml`                 |
| Weekly    | 15 min | `git fetch --prune` + scan open PRs for stuck reviews          | GitHub PR list                           |
| Per release | —    | `release:prepare` → review CHANGELOG → tag → push              | `scripts/prepare-release.mjs`            |
| Monthly   | 1 h    | ROADMAP review: close finished, re-prioritise, add new items   | `roadmap.md`                             |
| Monthly   | 30 min | Secret/key rotation: API key re-encrypt (safeStorage sanity)   | `provider-store.ts`                      |
| Quarterly | 2 h    | Major dependency spike: Pi SDK / Electron / React              | `npm outdated` → spike issue             |
| Yearly    | 1 h    | Audit community files (this file, CONTRIBUTING, SECURITY, COC)  | All governance files                     |

## Weekly Triage (Monday, 30 min)

1. Open GitHub Issues and scan for any without a label
2. Apply labels from `.github/labels.yml`:
   - `bug` / `enhancement` / `documentation` / `question` for type
   - `needs-info` if more details are needed (ask the user, then wait)
   - `needs-triage` if you're not sure
   - `wontfix` if the project is out of scope (cite a non-goal from
     `roadmap.md` §1.2 or `README.md` "What it is not")
   - `duplicate` and close with a link to the original
3. Anything clearly worth doing gets put on the **Next** milestone
4. Anything stale (>30 days with no response) gets a friendly ping or close

## Weekly Dependabot (Wednesday, 15 min)

1. Open Dependabot PRs
2. Trivial patch updates (e.g. `@types/*` patch bumps) → merge
3. Anything that touches a security-relevant package
   (`@earendil-works/pi-*`, `electron*`, `electron-updater`, `tsx`,
   `vitest`, `playwright`) → read the diff, run a quick smoke locally,
   then merge or escalate
4. Major version bumps (e.g. Electron 32 → 33) → open a spike issue, link
   the Dependabot PR, do not auto-merge

## Release Cadence

There is **no fixed schedule**. Release when one of the following is true:

- ≥ 3 user-visible changes accumulated in `CHANGELOG.md` `## Unreleased`
- A P0 / security fix has shipped
- A milestone is complete (see `roadmap.md`)

The procedure:

1. Finalise `## Unreleased` in `CHANGELOG.md` (group by `### 改进 / 修复 /
   文档 / 安全`)
2. Run `npm run release:prepare -- X.Y.Z` from the repo root
   - Validates the changelog has a `## X.Y.Z` section
   - Bumps `apps/desktop/package.json` + `package-lock.json`
   - For a minor-line start (`X.Y.0` with `Y > 0`), injects the previous
     line's rollup into the new section
3. Commit: `git commit -m "release: vX.Y.Z"`
4. Tag and push: `git tag vX.Y.Z && git push origin HEAD && git push origin vX.Y.Z`
5. CI: `.github/workflows/release.yml` rebuilds and uploads the GitHub
   Release (NSIS installer + `latest.yml`)

> **Anti-drift rule:** the script refuses to proceed if
> `apps/desktop/package.json` version already matches a later tag. If you
> see that error, something earlier was forgotten — re-tag in chronological
> order.

## Monthly ROADMAP Review (1 h)

1. Open `roadmap.md` Phase tables
2. For each row, update **Status** (`进行中` / `已完成` / `待启动` / `已废弃`)
3. Move finished rows to the bottom with their `完成度与最终交付` block
   filled in (a few bullets + commit refs)
4. If a new direction came up, add it to the appropriate Phase tail
5. Make sure Phase 4 (verification) references still match reality

## Quarterly Dependency Spike (2 h)

Pick the most-stale top-level dependency, ideally one of:

- `@earendil-works/pi-*` (upstream Pi SDK)
- `electron` / `electron-builder` / `electron-updater`
- `react` / `react-dom`
- `vitest` / `playwright`

1. Read upstream release notes
2. Open a spike Issue with the upgrade scope, breaking changes, and
   required test plan
3. Land in a `feat/upgrade-<name>` branch; do **not** mix with other work
4. After the spike is merged, add a `roadmap.md` entry for any
   follow-up cleanups it revealed

## Yearly Governance Audit (1 h)

- Re-read this file and `CONTRIBUTING.md`; update if the cadence drifted
- Verify `LICENSE` year is current
- Verify `CODE_OF_CONDUCT.md` still matches the latest
  [Contributor Covenant](https://www.contributor-covenant.org/) version
- Verify `SECURITY.md` "Supported Versions" matches the actual release
  policy
- Re-confirm the email in `CODEOWNERS` and `SECURITY.md` is still reachable

## When You're Away

If the maintainer is offline for >2 weeks, leave a note on the repo
description ("maintainer away until YYYY-MM-DD, expect slower reviews").
No automatic escalation; this is a small project.
