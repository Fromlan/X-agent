---
name: x-grill
description: Interview the user one question at a time until decisions are aligned. Use when the user wants to stress-test a plan, clarify requirements before coding, or runs /x-grill.
disable-model-invocation: true
---

# Grill

Interview relentlessly until every load-bearing decision is resolved.

## Rules

1. Ask **one question at a time**. Wait for the answer before the next.
2. For each question, give your **recommended answer** in one line, then ask.
3. If a *fact* can be found in the repo or environment (files, config, git), look it up — do not ask.
4. *Decisions* belong to the user — put each one to them.
5. Walk the decision tree branch by branch; resolve dependencies before dependents.
6. Do **not** start implementing until the user confirms shared understanding.

## Done

Summarize agreed decisions in a short bullet list, then ask whether to proceed (e.g. `/x-change-brief` or implement).
