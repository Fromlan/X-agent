# Pull Request

Thanks for sending a change to X-agent! Please fill in the sections below
so the maintainer can review efficiently.

> Read [`CONTRIBUTING.md`](../CONTRIBUTING.md) first. Keep PRs small
> (1 Issue → 1 PR, ideally 1-3 days of work).

## Summary

<!-- 1-3 bullet points: what does this change and why -->

-

## Linked issues

<!-- `Fixes #123` for fixes; `Refs #123` for related but not closing. -->

-

## Type of change

- [ ] Bug fix (`fix:`)
- [ ] New feature (`feat:`)
- [ ] Documentation (`docs:`)
- [ ] Refactor / chore (`chore:` / `refactor:`)
- [ ] Dependency bump (`build:` / `deps:`)
- [ ] CI / tooling (`ci:`)

## How was it tested?

- [ ] `npm run typecheck` passes (in `apps/desktop`)
- [ ] `npm test` (offline assertion scripts) passes
- [ ] `npm run test:unit` passes with coverage gate
- [ ] `npm run test:e2e` (if user-facing flow changed)
- [ ] Manual smoke: started the app, exercised the change
- [ ] New tests added (link or describe):

## Risk & rollout

- [ ] No database / on-disk state migration
- [ ] No security-relevant change (see [`SECURITY.md`](../SECURITY.md))
- [ ] No user-visible behavior change (or called out in `CHANGELOG.md`
      `## Unreleased`)
- [ ] Backward-compatible with previous release

## Checklist

- [ ] Follows [Conventional Commits](../CONTRIBUTING.md#commit-message-format)
- [ ] Branch is up to date with `master`
- [ ] Self-reviewed the diff
- [ ] `CHANGELOG.md` updated (if user-facing)
- [ ] No `apps/desktop/release/` artifacts committed
- [ ] No secrets / API keys / `~/.pi/agent/auth.json` content in the diff

## Screenshots / recordings

<!-- Optional. Skip if not user-visible. -->
