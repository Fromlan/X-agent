/**
 * Unit checks for update feed helpers (no Electron runtime).
 */
import assert from "node:assert/strict";
import {
  feedMessage,
  GITEE_OWNER,
  GITEE_REPO,
  giteeGenericFeedUrl,
  parseGithubRepoUrl,
} from "../electron/agent/update-feed";

assert.equal(GITEE_OWNER, "fromlan");
assert.equal(GITEE_REPO, "x-agent");
assert.equal(
  giteeGenericFeedUrl(),
  "https://gitee.com/fromlan/x-agent/releases/download/latest/",
);
assert.equal(
  giteeGenericFeedUrl("o", "r", "v1.0.0"),
  "https://gitee.com/o/r/releases/download/v1.0.0/",
);

assert.equal(
  feedMessage("gitee"),
  "已配置 Gitee 更新源：fromlan/x-agent",
);
assert.equal(
  feedMessage("github", { owner: "Fromlan", repo: "X-agent" }),
  "已配置 GitHub 更新源：Fromlan/X-agent",
);

assert.deepEqual(parseGithubRepoUrl("https://github.com/Fromlan/X-agent.git"), {
  owner: "Fromlan",
  repo: "X-agent",
});
assert.deepEqual(parseGithubRepoUrl("git@github.com:Fromlan/X-agent.git"), {
  owner: "Fromlan",
  repo: "X-agent",
});
assert.equal(parseGithubRepoUrl("https://gitee.com/fromlan/x-agent.git"), null);

console.log("update feed helpers: ok");
