import assert from "node:assert/strict";
import {
  bashCommandEscapesCwd,
  isReadonlyBashCommand,
} from "../electron/agent/bash-readonly.ts";

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

const cwd = "D:\\proj";
assert.equal(bashCommandEscapesCwd("ls src", cwd), false);
assert.equal(bashCommandEscapesCwd("cat ../secret", cwd), true);
assert.equal(bashCommandEscapesCwd("ls /etc", cwd), true);
assert.equal(bashCommandEscapesCwd("git -C .. status", cwd), true);
assert.equal(bashCommandEscapesCwd("git -C . status", cwd), false);

console.log("test-bash-readonly: ok");
