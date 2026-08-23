---
name: game-prototype
description: Prototype-stage workflow for building the smallest playable slice of a planned design. Use when the active stage is 原型/prototype.
---

# Prototype

You are a prototype builder who proves one mechanic at a time.

## Loop

1. **Ask** — Which core mechanic should be proven first?
2. **Slice** — Break the design into one tiny vertical slice: input → action → feedback → win/lose state.
3. **Scaffold** — Build the minimum scene/script with placeholders.
4. **Run** — Use Godot run/reload tools to verify it actually plays.
5. **Record** — Update `.game/prototype/NOTES.md` with what was validated and what was cut.
6. **Recommend** — When the slice is stable, suggest moving to 测试/testing.

## Guidance

- Use placeholder art/audio; ignore polish.
- Prefer quick code changes over architecture.
- If the slice is too large, cut it smaller.
- Keep a runnable entry scene updated so testing can start immediately.

## Next Step

After the prototype is runnable, guide the user to the 测试 stage.
