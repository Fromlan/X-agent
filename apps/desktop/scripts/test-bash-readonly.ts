import assert from "node:assert/strict";
import {
  bashCommandEscapesCwd,
  isReadonlyBashCommand,
} from "../electron/agent/session-mode/bash-readonly.ts";

assert.equal(isReadonlyBashCommand("git status"), true);
assert.equal(isReadonlyBashCommand("git status --short"), true);
assert.equal(isReadonlyBashCommand("git diff HEAD"), true);
assert.equal(isReadonlyBashCommand("git log -1 --oneline"), true);
assert.equal(isReadonlyBashCommand("git stash list"), true);
assert.equal(isReadonlyBashCommand("ls -la src"), true);
assert.equal(isReadonlyBashCommand("rg TODO apps"), true);
assert.equal(isReadonlyBashCommand("pwd && ls"), true);

assert.equal(isReadonlyBashCommand("git add ."), false);
assert.equal(isReadonlyBashCommand("git commit -m x"), false);
assert.equal(isReadonlyBashCommand("git stash push"), false);
assert.equal(isReadonlyBashCommand("rm -rf /"), false);
assert.equal(isReadonlyBashCommand("echo hi > out.txt"), false);
assert.equal(isReadonlyBashCommand("npm install"), false);
assert.equal(isReadonlyBashCommand("python script.py"), false);
assert.equal(isReadonlyBashCommand("python -c 'print(1)'"), false);
assert.equal(isReadonlyBashCommand("node -e '1'"), false);
assert.equal(isReadonlyBashCommand("find . -delete"), false);
assert.equal(isReadonlyBashCommand(""), false);

// Newline / substitution / over-broad heads must not bypass the hard gate.
assert.equal(isReadonlyBashCommand("ls\nrm -rf important"), false);
assert.equal(isReadonlyBashCommand("ls\r\nrm -rf important"), false);
assert.equal(isReadonlyBashCommand("echo $(rm -rf .)"), false);
assert.equal(isReadonlyBashCommand("echo `rm -rf .`"), false);
assert.equal(isReadonlyBashCommand("echo ${HOME}"), false);
assert.equal(isReadonlyBashCommand("godot --headless -s write.gd"), false);
assert.equal(isReadonlyBashCommand("dotnet build"), false);
assert.equal(isReadonlyBashCommand("dotnet run"), false);

const cwd = "D:\\proj";
assert.equal(bashCommandEscapesCwd("ls src", cwd), false);
assert.equal(bashCommandEscapesCwd("cat ../secret", cwd), true);
assert.equal(bashCommandEscapesCwd("ls /etc", cwd), true);
assert.equal(bashCommandEscapesCwd("git -C .. status", cwd), true);
assert.equal(bashCommandEscapesCwd("git -C . status", cwd), false);

// A2: bare `git stash` = `stash push` — must not be treated as `stash list`.
assert.equal(isReadonlyBashCommand("git stash"), false);
assert.equal(isReadonlyBashCommand("git stash list"), true);
assert.equal(isReadonlyBashCommand("git stash show"), true);
assert.equal(isReadonlyBashCommand("git stash push"), false);
assert.equal(isReadonlyBashCommand("git stash apply"), false);
assert.equal(isReadonlyBashCommand("git stash drop"), false);

// A2: ref-creation forms of branch/tag/remote write .git — block them.
assert.equal(isReadonlyBashCommand("git branch"), true);
assert.equal(isReadonlyBashCommand("git branch -a"), true);
assert.equal(isReadonlyBashCommand("git branch -v"), true);
assert.equal(isReadonlyBashCommand("git branch --show-current"), true);
assert.equal(isReadonlyBashCommand("git branch feature-x"), false);
assert.equal(isReadonlyBashCommand("git tag"), true);
assert.equal(isReadonlyBashCommand("git tag -l 'v*'"), true);
assert.equal(isReadonlyBashCommand("git tag v1.0"), false);
assert.equal(isReadonlyBashCommand("git tag -d v1.0"), false);
assert.equal(isReadonlyBashCommand("git remote -v"), true);
assert.equal(isReadonlyBashCommand("git remote show origin"), true);
assert.equal(isReadonlyBashCommand("git remote get-url origin"), true);
assert.equal(isReadonlyBashCommand("git remote add origin git@x:r.git"), false);
assert.equal(isReadonlyBashCommand("git remote set-url origin x"), false);
assert.equal(isReadonlyBashCommand("git remote remove origin"), false);

// A2: $VAR / ~ expansion is not detectable as a plain path — reject it.
assert.equal(isReadonlyBashCommand("echo $HOME"), false);
assert.equal(isReadonlyBashCommand("cat $HOME/x"), false);
assert.equal(isReadonlyBashCommand("ls $'D:/Secret'"), false);
assert.equal(isReadonlyBashCommand('ls $"D:/Secret"'), false);
assert.equal(isReadonlyBashCommand("echo $$"), false);
assert.equal(isReadonlyBashCommand("echo $?"), false);
assert.equal(bashCommandEscapesCwd("cat ~/.ssh/id_rsa", cwd), true);
assert.equal(bashCommandEscapesCwd("ls ~", cwd), true);

// A2: forced redirect `>|` truncates — must be blocked.
assert.equal(isReadonlyBashCommand("echo x >| ls"), false);
assert.equal(isReadonlyBashCommand("echo x > out.txt"), false);
assert.equal(isReadonlyBashCommand("cat < in.txt"), false);

// A2: `date -s` mutates the system clock.
assert.equal(isReadonlyBashCommand("date"), true);
assert.equal(isReadonlyBashCommand("date -s 2020-01-01"), false);
assert.equal(isReadonlyBashCommand("date --set=2020-01-01"), false);

// A2: case-normalized in-cwd paths must not be flagged as escapes (win32),
// and `..foo` (legal dir name) must not be confused with `..`.
assert.equal(
  bashCommandEscapesCwd("cat D:\\PROJ\\Sub\\f.txt", "d:\\proj"),
  false,
);
assert.equal(bashCommandEscapesCwd("cat D:\\proj\\..foo\\x", cwd), false);
assert.equal(bashCommandEscapesCwd("cat D:\\proj2\\x", cwd), true);

console.log("test-bash-readonly: ok");
