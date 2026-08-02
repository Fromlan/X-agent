/**
 * Package.json → GitHub feed resolution (canonical: update-feed.resolveGithubFeed).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGithubFeed } from "../electron/agent/update-feed";

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
  assert.deepEqual(resolveGithubFeed([pkg]), {
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
  assert.deepEqual(resolveGithubFeed([pkg]), {
    owner: "Acme",
    repo: "Other",
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("update feed resolve: ok");
