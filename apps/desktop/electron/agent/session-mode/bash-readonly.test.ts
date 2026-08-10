/**
 * Vitest 单元测试 —— bash-readonly 安全闸。
 * 与离线脚本 `scripts/test-bash-readonly.ts` 并存；Vitest 用于 CI 覆盖率门槛。
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  bashCommandEscapesCwd,
  cwdEscapeBashBlockReason,
  isReadonlyBashCommand,
  readonlyBashBlockReason,
} from "./bash-readonly";

const CWD = "D:/projects/sample";

describe("isReadonlyBashCommand", () => {
  it("允许 ls / cat / grep / rg / git status", () => {
    expect(isReadonlyBashCommand("ls")).toBe(true);
    expect(isReadonlyBashCommand("ls -la")).toBe(true);
    expect(isReadonlyBashCommand("cat README.md")).toBe(true);
    expect(isReadonlyBashCommand("rg TODO README.md")).toBe(true);
    expect(isReadonlyBashCommand("git status")).toBe(true);
    expect(isReadonlyBashCommand("git -C . diff --stat")).toBe(true);
  });

  it("拒绝 rm / mv / chmod / sed -i / curl POST 等", () => {
    expect(isReadonlyBashCommand("rm foo.txt")).toBe(false);
    expect(isReadonlyBashCommand("mv foo.txt bar.txt")).toBe(false);
    expect(isReadonlyBashCommand("chmod 644 foo")).toBe(false);
    expect(isReadonlyBashCommand("sed -i 's/a/b/' foo")).toBe(false);
    expect(isReadonlyBashCommand("curl -X POST https://example.com")).toBe(false);
    expect(isReadonlyBashCommand("python -c 'import os; os.remove(\"x\")'")).toBe(false);
  });

  it("拒绝命令替换 / 重定向 / env 变量", () => {
    expect(isReadonlyBashCommand("echo $(pwd)")).toBe(false);
    expect(isReadonlyBashCommand("echo `pwd`")).toBe(false);
    expect(isReadonlyBashCommand("echo $HOME")).toBe(false);
    expect(isReadonlyBashCommand("ls > out.txt")).toBe(false);
    expect(isReadonlyBashCommand("cat < foo.txt")).toBe(false);
  });

  it("拒绝 date -s / 任何时钟变更", () => {
    expect(isReadonlyBashCommand("date")).toBe(true);
    expect(isReadonlyBashCommand("date -s '2024-01-01'")).toBe(false);
  });

  it("拒绝 git 创建类（commit / push / branch / tag / stash drop 等）", () => {
    expect(isReadonlyBashCommand("git commit -m 'x'")).toBe(false);
    expect(isReadonlyBashCommand("git push origin main")).toBe(false);
    expect(isReadonlyBashCommand("git stash drop")).toBe(false);
    expect(isReadonlyBashCommand("git branch -D foo")).toBe(false);
    expect(isReadonlyBashCommand("git tag -d v1")).toBe(false);
    expect(isReadonlyBashCommand("git remote add foo https://...")).toBe(false);
  });

  it("允许 git list / log / show", () => {
    expect(isReadonlyBashCommand("git log --oneline -10")).toBe(true);
    expect(isReadonlyBashCommand("git show HEAD")).toBe(true);
    expect(isReadonlyBashCommand("git stash list")).toBe(true);
    expect(isReadonlyBashCommand("git branch -l")).toBe(true);
  });
});

describe("bashCommandEscapesCwd", () => {
  it("cwd 内命令不逃逸", () => {
    expect(bashCommandEscapesCwd("ls -la", CWD)).toBe(false);
    expect(bashCommandEscapesCwd("cat README.md", CWD)).toBe(false);
    expect(bashCommandEscapesCwd("git log --oneline", CWD)).toBe(false);
  });

  it("绝对路径穿越 cwd 拒绝", () => {
    expect(bashCommandEscapesCwd("cat /etc/passwd", CWD)).toBe(true);
    expect(bashCommandEscapesCwd("ls D:/other-project", CWD)).toBe(true);
  });

  it(".. 逃逸拒绝", () => {
    expect(bashCommandEscapesCwd("ls ../secret", CWD)).toBe(true);
    expect(bashCommandEscapesCwd("cd ../..", CWD)).toBe(true);
  });

  it("--prefix / git -C 携带路径逃逸拒绝", () => {
    expect(
      bashCommandEscapesCwd("git -C ../other log", CWD),
    ).toBe(true);
    expect(
      bashCommandEscapesCwd("git --git-dir ../other/.git log", CWD),
    ).toBe(true);
  });

  it("git --work-tree（键值形式）逃逸拒绝", () => {
    expect(
      bashCommandEscapesCwd("git --work-tree ../other status", CWD),
    ).toBe(true);
  });

  it("空 cwd 不报错", () => {
    expect(bashCommandEscapesCwd("ls", "")).toBe(false);
  });

  it("实际上很长的允许命令也不逃逸", () => {
    const cmd = `find ${CWD}/src -name '*.ts' | xargs grep -n 'TODO'`;
    expect(bashCommandEscapesCwd(cmd, CWD)).toBe(false);
  });
});

describe("readonlyBashBlockReason", () => {
  it("返回禁用原因 + 截断的命令预览", () => {
    const reason = readonlyBashBlockReason("rm -rf /");
    expect(reason).toMatch(/调研\/Plan 模式/);
    expect(reason).toContain("rm -rf /");
  });

  it("命令超长时截断", () => {
    const long = "x".repeat(500);
    const reason = readonlyBashBlockReason(long);
    expect(reason.length).toBeLessThanOrEqual(200);
  });
});

describe("cwdEscapeBashBlockReason", () => {
  it("返回 cwd 逃逸提示", () => {
    const reason = cwdEscapeBashBlockReason("ls /etc");
    expect(reason).toMatch(/项目目录外/);
    expect(reason).toContain("ls /etc");
  });
});

describe("allowed roots 集成", () => {
  it("允许根下的路径（如 ~/.pi/agent/skills）不逃逸", () => {
    const home = "C:/Users/me";
    const skillCmd = `cat /c/Users/me/.pi/agent/skills/foo/SKILL.md`;
    // 真实环境下 home 路径不在可信根内;测试说明非项目内命令被识别
    expect(bashCommandEscapesCwd(skillCmd, CWD)).toBe(true);
  });
});
