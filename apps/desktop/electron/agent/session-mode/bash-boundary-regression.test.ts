/** Exercise the actual Pi tool_call extensions without loading personal plugin configuration. */
import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { createPlanModeGuardExtension } from "./plan-mode-guard";
import { createDesignWriteGuardExtension } from "./design-write-guard";

vi.mock("../plugin-host", () => ({
  getReadablePluginRoots: () => [],
  isAllowedPluginPath: () => false,
}));

const cwd = mkdtempSync(join(tmpdir(), "x-agent-bash-boundary-"));
const outside = mkdtempSync(join(tmpdir(), "x-agent-bash-outside-"));
writeFileSync(join(cwd, "read me.txt"), "readonly fixture\n");
symlinkSync(outside, join(cwd, "external-link"), "junction");
afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

/** Capture the same callback Pi invokes before executing a tool. */
async function toolCallGuard(extension: InlineExtension) {
  let handler: ((event: { toolName: string; input: { command: string } }) => Promise<{ block: boolean } | undefined>) | undefined;
  await extension({ on: (event: string, callback: typeof handler) => {
    if (event === "tool_call") handler = callback;
  } } as never);
  if (!handler) throw new Error("tool_call handler missing");
  return handler;
}

const writes = [
  "git diff --output=leak.patch",
  "git log --output leak.log",
  "git status -c core.pager=touch",
  "git -c core.fsmonitor=touch status",
  "git config --edit",
  "git config -e",
  "git config --edi",
  "git remote update",
  "git remote -v update",
  "git remote --verbose set-url origin changed",
  "git cat-file --filters HEAD:README.md",
  "git branch -c old new",
  "git branch -uorigin/master",
  "git branch --set-upstream-to=origin/master",
  "find . -fprint leaked.txt",
  "find . -fprintf leaked.txt '%p'",
  "find . -fls leaked.txt",
  "yq -i '.value = 1' config.yaml",
  "yq --inplace '.value = 1' config.yaml",
  "yq -s '.name' data.yaml",
  "yq -s'.name' data.yaml",
  "rg --pre=touch fixture",
  "rg --hostname-bin=touch --heading fixture",
  "fd --exec touch '{}'",
  "ls & rm victim.txt",
  "env PATH=../evil ls",
  "git diff --out=leak.patch",
  "git diff --out\\put=leak.patch",
  "jq 'include \"../outside/module\"; .' config.json",
  "yq 'load(\"../outside/config.yml\")' config.yml",
  "file -C",
  "file --compile",
  "jq -f filter.jq config.json",
  "jq --from-file filter.jq config.json",
  "yq --from-file filter.yq config.yml",
  "rg --follow TODO .",
  "rg -L TODO .",
  "grep -R TODO .",
  "grep --dereference-recursive TODO .",
  "find -L . -type f",
  "fd --follow .",
  "tree -l .",
  "ls -LR .",
  "du -L .",
  "'env' bash -c 'touch leaked.txt'",
  "\"env\" -S 'bash -c touch'",
  "env env bash -c 'touch leaked.txt'",
  "less '+!touch leaked.txt' README.md",
];
const escapes = [
  "git --git-dir=../outside/.git status",
  "git --work-tree=../outside status",
  "git -C../outside status",
  "git diff --relative=../outside",
  "grep -f../outside/patterns.txt README.md",
  "grep -nf../outside/patterns.txt README.md",
  "grep --file=../outside/patterns.txt README.md",
  "rg --ignore-file=../outside/ignore TODO .",
  "jq --rawfile value ../outside/data.json '.' config.json",
  "jq -f../outside/filter.jq config.json",
  'cat "../outside/read me.txt"',
  "cat /c/Windows/win.ini",
  "rg --ignore-file=external-link/ignore TODO .",
  "git --git-dir=external-link status",
  "jq -Lexternal-link '.' config.json",
  "cat ~otheruser/secret",
  "file -m../outside/magic fixture",
  "file -m./magic:../outside/magic fixture",
];

describe.each(["ask", "plan", "design"] as const)("%s Bash parameter boundary", (mode) => {
  /** Build each real entry point with live mode/type callbacks and an isolated project. */
  async function guard(command: string) {
    const extension = mode === "design"
      ? createDesignWriteGuardExtension({ getSessionType: () => "design", getCwd: () => cwd })
      : createPlanModeGuardExtension({ getMode: () => mode, getAllowedTools: () => ["bash"], getCwd: () => cwd });
    return (await toolCallGuard(extension))({ toolName: "bash", input: { command } });
  }

  it.each(writes)("rejects side-effecting arguments: %s", async (command) => {
    expect((await guard(command))?.block, command).toBe(true);
  });
  it.each(escapes)("rejects paths embedded in arguments: %s", async (command) => {
    expect((await guard(command))?.block, command).toBe(true);
  });
  it.each(["git status --short", "git -C . diff --stat", "git config --file ./config --get user.name", "rg --glob=*.ts TODO .", 'cat "read me.txt"', "find . -name '*.ts'", "jq '.value' config.json"])("preserves legal reads: %s", async (command) => {
    expect(await guard(command), command).toBeUndefined();
  });
  it("executes an accepted read using real Git Bash", async () => {
    const gitPath = spawnSync("where.exe", ["git"], { encoding: "utf8", windowsHide: true }).stdout?.trim().split(/\r?\n/)[0] ?? "";
    const bash = join(dirname(gitPath), "..", "bin", "bash.exe");
    expect(existsSync(bash), "Windows regression requires installed Git Bash").toBe(true);
    const command = 'cat "read me.txt"';
    expect(await guard(command)).toBeUndefined();
    const result = spawnSync(bash, ["--noprofile", "--norc", "-c", command], { cwd, encoding: "utf8", windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("readonly fixture\n");
  });
});
