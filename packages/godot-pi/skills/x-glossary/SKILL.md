---
name: x-glossary
description: Build and sharpen project shared vocabulary in ../../../../docs/context.md. Use when naming is fuzzy, the agent is overly verbose, or domain terms need a single source of truth.
---

# Glossary

Keep a shared language so code and chat stay concise.

## Process

1. Prefer an existing root `../../../../docs/context.md`. If missing, **ask once** whether to create it.
2. Add or sharpen terms that appear in the current task — definition in one line, optional anti-synonyms.
3. Use those terms in subsequent replies and proposed names.
4. Do not invent a large glossary upfront; grow it from real ambiguity.

## File shape (suggested)

```markdown
# Context

## Terms

- **Term** — definition
```

Optional later: point to ADRs under `docs/adr/` if the repo already uses them — do not invent an ADR process by default.
