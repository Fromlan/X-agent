---
name: x-handoff
description: Compact the current session into a handoff document for a later session. Use when the user wants to pause work, switch chats, or runs /x-handoff.
disable-model-invocation: true
---

# Handoff

Produce a handoff another agent (or you in a new session) can continue from without rereading the whole chat.

## Include

- **Current goal** and status (done / in progress / blocked)
- **Decisions already made**
- **Key files** and what changed or still needs change
- **Commands / checks** already run and their results
- **Next concrete step** (one step)

## Persist

Write to `.pi/handoffs/<timestamp-or-slug>.md` or `.scratch/handoffs/…`, then give the absolute path so the user can `@` it in a new session.
