import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInsideCwd } from "../electron/agent/cwd-sandbox";
import { listProjectDir, readProjectFile } from "../electron/agent/project-fs";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const cwd = mkdtempSync(join(tmpdir(), "x-agent-sandbox-"));
try {
  mkdirSync(join(cwd, "sub"), { recursive: true });
  writeFileSync(join(cwd, "sub", "file.txt"), "hello from sub\n", "utf8");
  writeFileSync(join(cwd, "root.txt"), "hello from root\n", "utf8");

  // -- resolveInsideCwd --------------------------------------------------

  // relative path ok
  {
    const res = resolveInsideCwd(cwd, "sub/file.txt");
    assert(res.ok, "relative path inside cwd should resolve");
    if (res.ok) {
      assert(res.rel === "sub/file.txt", `expected normalized rel, got ${res.rel}`);
      assert(res.abs === join(cwd, "sub", "file.txt"), "abs should join cwd + rel");
    }
  }

  // relative path with Windows-style separators (if relevant on win32)
  if (process.platform === "win32") {
    const res = resolveInsideCwd(cwd, "sub\\file.txt");
    assert(res.ok, "backslash relative path should resolve on win32");
    if (res.ok) {
      assert(res.rel === "sub/file.txt", `expected forward-slash rel, got ${res.rel}`);
    }
  }

  // ".." escape rejected (posix-style)
  {
    const res = resolveInsideCwd(cwd, "../evil.txt");
    assert(!res.ok, "'..' escape via relative path must be rejected");
  }

  // ".." escape rejected (nested, still resolves outside)
  {
    const res = resolveInsideCwd(cwd, "sub/../../evil.txt");
    assert(!res.ok, "nested '..' escape must be rejected");
  }

  // ".." escape rejected (Windows-style separators)
  if (process.platform === "win32") {
    const res = resolveInsideCwd(cwd, "..\\evil.txt");
    assert(!res.ok, "'..' escape via backslash path must be rejected");
  }

  // absolute path outside cwd rejected
  {
    const outsideDir = mkdtempSync(join(tmpdir(), "x-agent-outside-"));
    try {
      const outsideFile = join(outsideDir, "secret.txt");
      writeFileSync(outsideFile, "nope", "utf8");
      const res = resolveInsideCwd(cwd, outsideFile);
      assert(!res.ok, "absolute path outside cwd must be rejected");
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  }

  // absolute path inside cwd accepted
  {
    const abs = join(cwd, "sub", "file.txt");
    const res = resolveInsideCwd(cwd, abs);
    assert(res.ok, "absolute path inside cwd should be accepted");
    if (res.ok) {
      assert(res.rel === "sub/file.txt", `expected rel from abs, got ${res.rel}`);
    }
  }

  // absolute path equal to cwd root accepted, rel empty
  {
    const res = resolveInsideCwd(cwd, cwd);
    assert(res.ok, "absolute path equal to cwd root should be accepted");
    if (res.ok) {
      assert(res.rel === "", `expected empty rel for root, got '${res.rel}'`);
    }
  }

  // null byte rejected
  {
    const res = resolveInsideCwd(cwd, "sub/file.txt\0.png");
    assert(!res.ok, "null byte in relative path must be rejected");
  }

  // empty relative path resolves to cwd root itself
  {
    const res = resolveInsideCwd(cwd, "");
    assert(res.ok, "empty relative path should resolve to cwd root");
    if (res.ok) {
      assert(res.rel === "", "empty relative path yields empty rel");
      assert(res.abs === join(cwd), "empty relative path yields cwd abs");
    }
  }

  // missing cwd rejected regardless of relPath
  {
    const missingCwd = join(tmpdir(), "x-agent-does-not-exist-xyz");
    const res = resolveInsideCwd(missingCwd, "file.txt");
    assert(!res.ok, "non-existent cwd must be rejected");
  }

  // empty cwd rejected
  {
    const res = resolveInsideCwd("", "file.txt");
    assert(!res.ok, "empty cwd must be rejected");
  }

  // sibling directory that merely shares a path prefix must not be treated as inside
  {
    const sibling = `${cwd}-evil`;
    mkdirSync(sibling, { recursive: true });
    try {
      const res = resolveInsideCwd(cwd, join(sibling, "file.txt"));
      assert(!res.ok, "prefix-sibling directory must not be treated as inside cwd");
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  }

  console.log("resolveInsideCwd: ok");

  // -- listProjectDir / readProjectFile -----------------------------------

  // list root
  {
    const res = listProjectDir(cwd, "");
    assert(res.ok, `list root should succeed: ${res.error}`);
    const names = (res.entries ?? []).map((e) => e.name).sort();
    assert(names.includes("sub"), "root listing should include 'sub' dir");
    assert(names.includes("root.txt"), "root listing should include 'root.txt'");
  }

  // list subdirectory
  {
    const res = listProjectDir(cwd, "sub");
    assert(res.ok, `list subdir should succeed: ${res.error}`);
    const names = (res.entries ?? []).map((e) => e.name);
    assert(names.includes("file.txt"), "subdir listing should include 'file.txt'");
  }

  // reject list escape via "../"
  {
    const res = listProjectDir(cwd, "../");
    assert(!res.ok, "listing '../' must be rejected");
  }

  // read file inside
  {
    const res = readProjectFile(cwd, "sub/file.txt");
    assert(res.ok, `read inside file should succeed: ${res.error}`);
    assert(res.content === "hello from sub\n", "file content should match");
    assert(res.path === "sub/file.txt", "returned path should be normalized rel path");
  }

  // reject read outside
  {
    const outsideDir = mkdtempSync(join(tmpdir(), "x-agent-outside-read-"));
    try {
      const outsideFile = join(outsideDir, "secret.txt");
      writeFileSync(outsideFile, "nope", "utf8");
      const res = readProjectFile(cwd, outsideFile);
      assert(!res.ok, "reading absolute path outside cwd must be rejected");
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  }

  // reject read escape via "../"
  {
    const res = readProjectFile(cwd, "../nope.txt");
    assert(!res.ok, "reading '../nope.txt' must be rejected");
  }

  // reject reading the root directory itself as a file
  {
    const res = readProjectFile(cwd, "");
    assert(!res.ok, "reading empty path (root dir) as file must be rejected");
  }

  console.log("listProjectDir/readProjectFile: ok");
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log("test-cwd-sandbox: ok");
