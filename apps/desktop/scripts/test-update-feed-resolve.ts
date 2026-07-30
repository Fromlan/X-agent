/**
 * Package.json → GitHub feed resolution (mirrors auto-updater.resolveGithubFeed).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_GITHUB_OWNER,
  DEFAULT_GITHUB_REPO,
  parseGithubRepoUrl,
} from "../electron/agent/update-feed";

function resolveFromPackageJson(path: string): { owner: string; repo: string } {
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    repository?: string | { url?: string };
    build?: {
      publish?:
        | { provider?: string; owner?: string; repo?: string }
        | Array<{ provider?: string; owner?: string; repo?: string }>;
    };
  };
  const publish = raw.build?.publish;
  const publishEntry = Array.isArray(publish) ? publish[0] : publish;
  if (
    publishEntry?.provider === "github" &&
    publishEntry.owner &&
    publishEntry.repo
  ) {
    return { owner: publishEntry.owner, repo: publishEntry.repo };
  }
  const repoUrl =
    typeof raw.repository === "string"
      ? raw.repository
      : raw.repository?.url;
  if (repoUrl) {
    const parsed = parseGithubRepoUrl(repoUrl);
    if (parsed) return parsed;
  }
  return { owner: DEFAULT_GITHUB_OWNER, repo: DEFAULT_GITHUB_REPO };
}

const dir = mkdtempSync(join(tmpdir(), "x-agent-update-resolve-"));
try {
  const pkg = join(dir, "package.json");
  writeFileSync(
    pkg,
    JSON.stringify({
      repository: "https://github.com/Acme/Other.git",
      build: {
        publish: { provider: "github", owner: "Fromlan", repo: "X-agent" },
      },
    }),
    "utf8",
  );
  assert.deepEqual(resolveFromPackageJson(pkg), {
    owner: "Fromlan",
    repo: "X-agent",
  });

  writeFileSync(
    pkg,
    JSON.stringify({
      repository: { url: "https://github.com/Acme/Other.git" },
    }),
    "utf8",
  );
  assert.deepEqual(resolveFromPackageJson(pkg), {
    owner: "Acme",
    repo: "Other",
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("update feed resolve: ok");
