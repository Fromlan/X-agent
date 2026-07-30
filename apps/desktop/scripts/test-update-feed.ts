/**
 * GitHub update-feed helper assertions.
 */
import assert from "node:assert/strict";
import {
  DEFAULT_GITHUB_OWNER,
  DEFAULT_GITHUB_REPO,
  feedMessage,
  githubReleasesUrl,
  parseGithubRepoUrl,
} from "../electron/agent/update-feed";

assert.equal(DEFAULT_GITHUB_OWNER, "Fromlan");
assert.equal(DEFAULT_GITHUB_REPO, "X-agent");

assert.deepEqual(parseGithubRepoUrl("https://github.com/Fromlan/X-agent"), {
  owner: "Fromlan",
  repo: "X-agent",
});
assert.deepEqual(parseGithubRepoUrl("https://github.com/Fromlan/X-agent.git"), {
  owner: "Fromlan",
  repo: "X-agent",
});
assert.deepEqual(parseGithubRepoUrl("git@github.com:Fromlan/X-agent.git"), {
  owner: "Fromlan",
  repo: "X-agent",
});
assert.equal(parseGithubRepoUrl("https://example.com/Fromlan/X-agent.git"), null);

assert.equal(
  feedMessage(),
  "已配置 GitHub 更新源：Fromlan/X-agent",
);
assert.equal(
  feedMessage({ owner: "a", repo: "b" }),
  "已配置 GitHub 更新源：a/b",
);
assert.equal(
  githubReleasesUrl({ owner: "Fromlan", repo: "X-agent" }),
  "https://github.com/Fromlan/X-agent/releases",
);

console.log("update feed helpers: ok");
