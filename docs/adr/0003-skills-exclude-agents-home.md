# ADR-0003: Skills discovery excludes ~/.agents/skills

## Status

Accepted

## Context

Pi's `DefaultResourceLoader` auto-indexes `~/.agents/skills` (Cursor/Claude home skills). Mixing those into X-agent sessions causes duplicate / irrelevant skills and context bloat.

## Decision

`skillsOverride` filters out `~/.agents/skills`. X-agent only uses `~/.pi/agent/skills`, project `.pi/skills`, and installed Packages. Godot-tier `godot-*` skills are indexed only when `cwd` has `project.godot`. Skill descriptions in the available-skills index are truncated for prompt size.

## Consequences

- Users must install domain skills via X-agent Packages or `~/.pi/agent/skills`.
- Cursor home skills do not appear unless copied into a supported root.
