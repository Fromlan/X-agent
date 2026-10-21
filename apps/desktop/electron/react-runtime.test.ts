/** Exercise the renderer's real dependency entry point so React/React DOM mismatches fail before packaging. */
import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);

it("loads the shipped React DOM client with a compatible React runtime", () => {
  expect(() => require("react-dom/client")).not.toThrow();
});
