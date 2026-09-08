/**
 * Tool-registry derive helper.
 *
 * `AVAILABLE_TOOLS` / `GODOT_TOOLS` are the two source-of-truth const tuples
 * (see ./available.ts and ./godot.ts). The two derived lists
 * `ALL_TOGGLEABLE_TOOLS` (= AVAILABLE 鈭?GODOT) and
 * `SESSION_TOOL_REGISTRY` (= ALL_TOGGLEABLE 鈭?{ write_plan }) must:
 *   1. contain every source entry exactly once (no silent loss)
 *   2. reject duplicate tool names (would crash `setActiveToolsByName`)
 *   3. preserve order 鈥?`AVAILABLE` first, then `GODOT`, then `WRITE_PLAN`
 *
 * `deriveToolList` is a tiny no-spread helper that:
 *   - concatenates source tuples **in order**
 *   - throws at module load time on duplicates (caught by vitest's
 *     `boundary test` in derive.test.ts + the in-source comment
 *     at the call site in derived.ts)
 *
 * Why not a generic `[...A, ...B] as const`?
 *   The previous `as const` spread silently lost duplicate detection.
 *   Adding a tool that already exists in another source would compile,
 *   pass typecheck, and only fail at runtime when Pi tried to register
 *   two tools with the same name. This helper makes that mistake a
 *   load-time throw, so `npm test` catches it before the package
 *   reaches a session.
 */
export function deriveToolList(
  ...sources: readonly (readonly string[])[]
): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    for (const t of src) {
      if (seen.has(t)) {
        throw new Error(
          `[tools] duplicate tool name in derive: "${t}" 鈥?fix source-of-truth arrays`,
        );
      }
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
