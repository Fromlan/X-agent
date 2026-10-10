/** Ensure release identity failures cannot be hidden by mutating package metadata. */
import { expect, it } from "vitest";
import { validateRelease } from "../../../scripts/validate-release.mjs";
const valid = { requested: "v0.6.5", packageVersion: "0.6.5", changelog: "## 0.6.5\n\n- A verified fix\n\n## 0.6.4\nold", tag: "v0.6.5", head: "abc", tagCommit: "abc" };
it("accepts a matching immutable commit/version/changelog", () => expect(validateRelease(valid)).toEqual({ version: "0.6.5", tag: "v0.6.5" }));
it.each([
  { requested: '0.6.5"; echo injected' }, { packageVersion: "0.6.4" }, { tagCommit: "different" },
  { tag: "v0.6.4" }, { changelog: "## 0.6.5\n\n## 0.6.4\nold" }, { changelog: "## 0.6.4\nold" },
])("rejects release identity mismatch or empty notes: %j", (patch) => expect(() => validateRelease({ ...valid, ...patch })).toThrow());
