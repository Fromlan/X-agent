/** Exercise the actual Pi tool_call extensions without loading personal plugin configuration. */
import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

const fixtureRoot = mkdtempSync(join(tmpdir(), "x-agent-bash-boundary-"));
const cwd = join(fixtureRoot, "project");
const outside = join(fixtureRoot, "outside");
mkdirSync(cwd);
mkdirSync(outside);
mkdirSync(join(cwd, "sub", "deep"), { recursive: true });
writeFileSync(join(cwd, "read me.txt"), "readonly fixture\n");
for (const filename of ["config", "config with spaces", "config=fixture"]) {
  writeFileSync(join(cwd, filename), "[user]\nname = inside-fixture\n");
  writeFileSync(join(outside, filename), "[user]\nname = outside-fixture\n");
}
writeFileSync(join(cwd, "file-list"), `${join(outside, "config").replace(/\\/g, "/")}\n`);
writeFileSync(join(cwd, "included-config"), "[user]\nname = inside-fixture\n[include]\npath = ../outside/config\n");
writeFileSync(join(cwd, "input"), "readonly fixture\n");
writeFileSync(join(outside, "pattern"), "readonly\n");
writeFileSync(join(outside, "data.json"), '{"fixture":true}\n');
writeFileSync(join(outside, "dates"), "2026-10-13\n");
writeFileSync(join(cwd, "sub", "config"), "[user]\nname = inside-fixture\n");
writeFileSync(join(cwd, "sub", "deep", "config"), "[user]\nname = inside-fixture\n");
symlinkSync(outside, join(cwd, "external-link"), "junction");
symlinkSync(outside, join(cwd, "-link"), "junction");
symlinkSync(outside, join(cwd, "sub", "link"), "junction");
symlinkSync(outside, join(cwd, "sub", "deep", "link"), "junction");
afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Run only disposable fixture commands with Git's system/global configuration isolated. */
function runFixtureBash(command: string) {
  const gitPath = spawnSync("where.exe", ["git"], { encoding: "utf8", windowsHide: true }).stdout?.trim().split(/\r?\n/)[0] ?? "";
  const bash = join(dirname(gitPath), "..", "bin", "bash.exe");
  expect(existsSync(bash), "Windows regression requires installed Git Bash").toBe(true);
  return spawnSync(bash, ["--noprofile", "--norc", "-c", command], {
    cwd, encoding: "utf8", windowsHide: true,
    env: { ...process.env, HOME: fixtureRoot, USERPROFILE: fixtureRoot, BASH_ENV: "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(fixtureRoot, "unused-global-config") },
  });
}

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
  "git config -f./included-config --includes --get user.name",
  "git config -f./included-config --incl --get user.name",
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
  "file -f../outside/list",
  "file -fexternal-link/list",
  "file -f./file-list",
  "FILE -f./file-list",
  "file --files-from=./file-list",
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
  "GIT -C../outside status",
  "GIT config -f../outside/config --get user.name",
  "git config -f../outside/config --get user.name",
  'git config -f"../outside/config with spaces" --get user.name',
  "git config -fexternal-link/config --get user.name",
  `git config -f"${join(outside, "config").replace(/\\/g, "/")}" --get user.name`,
  `git config -f"${join(outside, "config with spaces").replace(/\\/g, "/")}" --get user.name`,
  "git diff -O../outside/order",
  "git diff -Oexternal-link/order",
  `git diff -O"${join(outside, "order").replace(/\\/g, "/")}"`,
  "date -f../outside/dates",
  "date -fexternal-link/dates",
  `date -f"${join(outside, "dates").replace(/\\/g, "/")}"`,
  "git diff --relative=../outside",
  "grep -f../outside/patterns.txt README.md",
  "GREP -f../outside/patterns.txt README.md",
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
  "FILE -m./magic:../outside/magic fixture",
  "grep -f -link/pattern input",
  "grep -nf -link/pattern input",
  "grep -f-link/pattern input",
  "grep --file=-link/pattern input",
  "GREP -f -link/pattern input",
  "git config -f -link/config --get user.name",
  "git config -f-link/config --get user.name",
  "git -C -link status",
  "date -f -link/dates",
  "date --f -link/dates",
  "jq --rawfile contents -link/data.json '.' config.json",
  "jq --slurpfile contents -link/data.json '.' config.json",
  "jq -L -link '.' config.json",
  "file -m -link/magic fixture",
  "cat -- -link/config",
  "git -C sub config -flink/config --get user.name",
  "git -Csub config -f link/config --get user.name",
  'GIT -C"sub" config -f"link/config with spaces" --get user.name',
  "git -C sub -C deep config -flink/config --get user.name",
  "git -Csub -Cdeep config -f link/config --get user.name",
  "git -C sub diff -Olink/order --no-index config config",
  "git -C sub diff --no-index link/config config",
  "git -C sub config -flink/config=fixture --get user.name",
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
  it.each(["git status --short", "git -C . diff --stat", "git config --file ./config --get user.name", "git config -f./config --get user.name", 'git config -f"config with spaces" --get user.name', "git config -f./included-config --no-includes --get user.name", "git diff -O./order", "git -C sub -C .. config -f./config --get user.name", "git -C sub diff -C --no-index config config", "date -f./dates", "rg --glob=*.ts TODO .", "rg constructor .", 'cat "read me.txt"', "find . -name '*.ts'", "jq '.value' config.json"])("preserves legal reads: %s", async (command) => {
    expect(await guard(command), command).toBeUndefined();
  });
  it("executes an accepted read using real Git Bash", async () => {
    const command = 'cat "read me.txt"';
    expect(await guard(command)).toBeUndefined();
    const result = runFixtureBash(command);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("readonly fixture\n");
  });
  it.each(["git", "GIT"])("proves real %s attached config reads outside unless its tool entry is blocked", async (head) => {
    const command = `${head} config -f../outside/config --get user.name`;
    const ungated = runFixtureBash(command);
    expect(ungated.status, ungated.stderr).toBe(0);
    expect(ungated.stdout).toBe("outside-fixture\n");
    expect((await guard(command))?.block).toBe(true);
  });
  it.each(["--includes", "--incl"])("rejects real Git indirect external reads enabled by %s", async (option) => {
    const command = `git config -f./included-config ${option} --get user.name`;
    const ungated = runFixtureBash(command);
    expect(ungated.status, ungated.stderr).toBe(0);
    expect(ungated.stdout).toBe("outside-fixture\n");
    expect((await guard(command))?.block).toBe(true);
  });
  it("rejects a dash-prefixed junction after a real grep file option", async () => {
    const command = "grep -f -link/pattern input";
    const ungated = runFixtureBash(command);
    expect(ungated.status, ungated.stderr).toBe(0);
    expect(ungated.stdout).toBe("readonly fixture\n");
    expect((await guard(command))?.block).toBe(true);
  });
  it("rejects a dash-prefixed junction after the real cat option terminator", async () => {
    const command = "cat -- -link/config";
    const ungated = runFixtureBash(command);
    expect(ungated.status, ungated.stderr).toBe(0);
    expect(ungated.stdout).toContain("outside-fixture");
    expect((await guard(command))?.block).toBe(true);
  });
  it("rejects a real GNU date abbreviated file option through a dash-prefixed junction", async () => {
    const command = "date --f -link/dates";
    const ungated = runFixtureBash(command);
    expect(ungated.status, ungated.stderr).toBe(0);
    expect(ungated.stdout).toContain("2026");
    expect((await guard(command))?.block).toBe(true);
  });
  it.each(["git -C sub config -flink/config --get user.name", "git -C sub config -f link/config --get user.name", 'GIT -C "sub" config -f"link/config with spaces" --get user.name', "git -C sub -C deep config -flink/config --get user.name", "git -C sub config -flink/config=fixture --get user.name"])("rejects a real Git config read relative to its effective directory: %s", async (command) => {
    expect(existsSync(join(cwd, "link"))).toBe(false);
    const ungated = runFixtureBash(command);
    expect(ungated.status, ungated.stderr).toBe(0);
    expect(ungated.stdout).toBe("outside-fixture\n");
    expect((await guard(command))?.block).toBe(true);
  });
  it.each(["git config -f./config --get user.name", "GIT config -f./config --get user.name", 'git config -f"config with spaces" --get user.name', "git config -f./config=fixture --get user.name", "git config -f./included-config --no-includes --get user.name", "git -C sub config -f./config --get user.name", "git -C sub -C deep config -f./config --get user.name", "git -C sub -C .. config -f./config --get user.name"])("executes an accepted real Git configuration read: %s", async (command) => {
    expect(await guard(command)).toBeUndefined();
    const result = runFixtureBash(command);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("inside-fixture\n");
  });
  it("keeps Git diff copy detection distinct from its global directory option", async () => {
    const command = "git -C sub diff -C --no-index config config";
    expect(await guard(command)).toBeUndefined();
    const result = runFixtureBash(command);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
  });
});
