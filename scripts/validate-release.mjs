/** Reject unverified release identities before packaging; never rewrite the checked-out version. */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Validate canonical semver, package identity and a non-empty changelog section. */
export function validateRelease({ requested, packageVersion, changelog, tag, head, tagCommit }) {
  const version = String(requested ?? "").replace(/^v/, "");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)) throw new Error("Invalid release version");
  if (version !== packageVersion) throw new Error("Release version does not match apps/desktop/package.json");
  if (tag !== `v${version}` || !head || head !== tagCommit) throw new Error("Release tag must exist and point to the checked-out commit");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^##[ \\t]+\\[?${escaped}\\]?(?:[ \\t]+.*)?$`);
  const start = lines.findIndex((line) => heading.test(line));
  const end = lines.findIndex((line, i) => i > start && /^##[ \t]/.test(line));
  if (start < 0 || !lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim()) throw new Error("Release changelog section is missing or empty");
  return { version, tag };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const requested = process.env.RELEASE_VERSION ?? "";
  const version = requested.replace(/^v/, "");
  // Reject shell/Git option injection before passing the tag as an argument.
  if (!/^[0-9A-Za-z.-]+$/.test(version) || !/^\d/.test(version)) throw new Error("Invalid release input");
  const tag = `v${version}`;
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const result = validateRelease({
    requested,
    packageVersion: JSON.parse(readFileSync(resolve(root, "apps/desktop/package.json"), "utf8")).version,
    changelog: readFileSync(resolve(root, "CHANGELOG.md"), "utf8"),
    tag, head: git(["rev-parse", "HEAD"]), tagCommit: git(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]),
  });
  console.log(`Release identity verified: ${result.tag}`);
}
