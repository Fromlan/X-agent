/**
 * Offline unit tests for buildPairHandoff (injected git runner).
 */

import {
  buildPairHandoff,
  truncateHandoff,
  type GitRunner,
} from "../electron/agent/fleet-handoff";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(truncateHandoff("abc") === "abc", "no truncate short");

function mockGit(map: Record<string, string>): GitRunner {
  return async (_cwd, args) => {
    const key = args.join(" ");
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      return { ok: true, stdout: map[key]! };
    }
    return { ok: true, stdout: "" };
  };
}

async function main(): Promise<void> {
  const unstaged = await buildPairHandoff(
    "/proj",
    () => "excerpt",
    mockGit({
      "diff --stat": " a.ts | 1 +\n",
      diff: "+sprint\n",
    }),
  );
  assert(unstaged.includes("git diff --stat"), "includes unstaged stat");
  assert(unstaged.includes("+sprint"), "includes unstaged diff");
  assert(!unstaged.includes("会话摘录"), "prefers diff over excerpt");

  const stagedOnly = await buildPairHandoff(
    "/proj",
    () => "excerpt",
    mockGit({
      "diff --cached --stat": " b.ts | 2 ++\n",
      "diff --cached": "+staged\n",
    }),
  );
  assert(stagedOnly.includes("git diff --cached"), "includes cached diff");
  assert(stagedOnly.includes("+staged"), "cached body");

  const statusOnly = await buildPairHandoff(
    "/proj",
    () => "excerpt",
    mockGit({
      "status --short": "?? new-file.ts\n",
    }),
  );
  assert(statusOnly.includes("git status --short"), "status fallback");
  assert(statusOnly.includes("new-file.ts"), "untracked listed");
  assert(!statusOnly.includes("会话摘录"), "status before excerpt");

  const excerptOnly = await buildPairHandoff(
    "/proj",
    () => "【助理】\nok",
    mockGit({}),
  );
  assert(excerptOnly.includes("会话摘录"), "excerpt fallback");
  assert(excerptOnly.includes("【助理】"), "excerpt body");

  const empty = await buildPairHandoff("/proj", () => "", mockGit({}));
  assert(empty.includes("无 git 变更"), "empty message");

  console.log("test-fleet-handoff: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
