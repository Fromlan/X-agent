/**
 * inject-splash-version —— 离线断言。
 *
 * 覆盖以下契约:
 *  - 占位符替换:首次执行把 {{X_AGENT_VERSION}} 替换成 v${pkg.version}
 *  - 幂等:再次执行不修改文件(避免无意义的 git diff)
 *  - mismatch 路径(默认模式):文件里的版本号字面量与 package.json 不一致 → 自动改写
 *  - check-only 模式:版本对不上时不写文件,返回 mismatch(供 CI 校验)
 *  - 版本 span 不存在:不动文件(避免误改手工 markup)
 *  - 多占位符场景:只替换 X_AGENT_VERSION,其他 {{...}} 保持原样
 *  - 缺 version 字段:抛错
 *
 * 用法: tsx scripts/test-inject-splash-version.ts
 */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  injectSplashVersion,
  runCli,
  PLACEHOLDER,
} from "./inject-splash-version.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeFixture(opts: { version: string; splashBody: string }): {
  dir: string;
  pkg: string;
  splash: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "x-agent-splash-inject-"));
  const pkg = join(dir, "package.json");
  const splash = join(dir, "splash.html");
  writeFileSync(
    pkg,
    JSON.stringify({ name: "fixture", version: opts.version }),
    "utf8",
  );
  mkdirSync(dirname(splash), { recursive: true });
  writeFileSync(splash, opts.splashBody, "utf8");
  return { dir, pkg, splash };
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

const SPLASH_TEMPLATE = `<!doctype html><html><body>
  <span class="version">${PLACEHOLDER}</span>
</body></html>`;

// 1. 首次注入:占位符被替换为 v${version}
{
  const fx = makeFixture({ version: "0.4.0", splashBody: SPLASH_TEMPLATE });
  try {
    const result = injectSplashVersion({
      packageJsonPath: fx.pkg,
      splashPath: fx.splash,
    });
    assert.equal(result.kind, "wrote");
    assert.equal(result.version, "v0.4.0");
    const after = readFileSync(fx.splash, "utf8");
    assert.ok(!after.includes(PLACEHOLDER), "占位符应已被替换");
    assert.match(after, /<span class="version">v0\.4\.0<\/span>/);
  } finally {
    cleanup(fx.dir);
  }
}

// 2. 幂等:再次执行 noop(占位符已被替换,版本匹配)
{
  const fx = makeFixture({ version: "0.4.0", splashBody: SPLASH_TEMPLATE });
  try {
    injectSplashVersion({ packageJsonPath: fx.pkg, splashPath: fx.splash });
    const before = readFileSync(fx.splash, "utf8");
    const r2 = injectSplashVersion({
      packageJsonPath: fx.pkg,
      splashPath: fx.splash,
    });
    assert.equal(r2.kind, "noop");
    const after = readFileSync(fx.splash, "utf8");
    assert.equal(after, before, "noop 路径不应修改文件");
  } finally {
    cleanup(fx.dir);
  }
}

// 3. mismatch 默认路径:文件里是 v0.3.12,package.json 是 0.4.0 → 自动改写到 v0.4.0
//    这是用户场景的核心:npm version patch 之后脚本应自动跟进,不留手动更新负担。
{
  const fx = makeFixture({
    version: "0.4.0",
    splashBody: '<html><span class="version">v0.3.12</span></html>',
  });
  try {
    const result = injectSplashVersion({
      packageJsonPath: fx.pkg,
      splashPath: fx.splash,
    });
    assert.equal(result.kind, "wrote");
    assert.equal(result.version, "v0.4.0");
    const after = readFileSync(fx.splash, "utf8");
    assert.match(after, /<span class="version">v0\.4\.0<\/span>/);
    assert.ok(!after.includes("v0.3.12"), "旧版本字面量应被改写");
  } finally {
    cleanup(fx.dir);
  }
}

// 4. 文件已有正确版本号:noop(不强行再写一遍)
{
  const fx = makeFixture({
    version: "0.4.0",
    splashBody: '<html><span class="version">v0.4.0</span></html>',
  });
  try {
    const result = injectSplashVersion({
      packageJsonPath: fx.pkg,
      splashPath: fx.splash,
    });
    assert.equal(result.kind, "noop");
  } finally {
    cleanup(fx.dir);
  }
}

// 5. check-only 模式:有占位符时不写文件,返回 mismatch
{
  const fx = makeFixture({ version: "0.4.0", splashBody: SPLASH_TEMPLATE });
  try {
    const before = readFileSync(fx.splash, "utf8");
    const r = injectSplashVersion({
      packageJsonPath: fx.pkg,
      splashPath: fx.splash,
      checkOnly: true,
    });
    assert.equal(r.kind, "mismatch");
    assert.equal(r.fileVersion, PLACEHOLDER);
    const after = readFileSync(fx.splash, "utf8");
    assert.equal(after, before, "checkOnly 不应修改文件");
  } finally {
    cleanup(fx.dir);
  }
}

// 5b. check-only 模式:版本字面量不一致 → mismatch,不写文件
{
  const fx = makeFixture({
    version: "0.4.0",
    splashBody: '<span class="version">v0.3.12</span>',
  });
  try {
    const before = readFileSync(fx.splash, "utf8");
    const r = injectSplashVersion({
      packageJsonPath: fx.pkg,
      splashPath: fx.splash,
      checkOnly: true,
    });
    assert.equal(r.kind, "mismatch");
    assert.equal(r.fileVersion, "v0.3.12");
    const after = readFileSync(fx.splash, "utf8");
    assert.equal(after, before, "checkOnly 不应修改文件");
  } finally {
    cleanup(fx.dir);
  }
}

// 5c. runCli 端到端:对真实 public/splash.html 的 --check-only
//     已同步的文件 → 退出码 0,无副作用。
{
  const realSplash = join(__dirname, "..", "public", "splash.html");
  const before = readFileSync(realSplash, "utf8");
  try {
    const code = runCli(["--check-only"]);
    assert.equal(code, 0, "已同步的真实 splash.html 通过 check-only");
    const after = readFileSync(realSplash, "utf8");
    assert.equal(after, before, "check-only 不应修改真实文件");
  } finally {
    const after = readFileSync(realSplash, "utf8");
    if (after !== before) {
      writeFileSync(realSplash, before, "utf8");
    }
  }
}

// 6. package.json 缺 version 字段:抛错
{
  const dir = mkdtempSync(join(tmpdir(), "x-agent-splash-inject-"));
  const pkg = join(dir, "package.json");
  const splash = join(dir, "splash.html");
  writeFileSync(pkg, JSON.stringify({ name: "no-version" }), "utf8");
  writeFileSync(splash, SPLASH_TEMPLATE, "utf8");
  try {
    assert.throws(
      () => injectSplashVersion({ packageJsonPath: pkg, splashPath: splash }),
      /缺少合法的 version 字段/,
    );
  } finally {
    cleanup(dir);
  }
}

// 7. 多占位符(如 splash 同时含其他 {{...}} 文本)只替换 X_AGENT_VERSION
{
  const fx = makeFixture({
    version: "0.4.0",
    splashBody: `<html>{{OTHER_TOTHER}}<span class="version">${PLACEHOLDER}</span></html>`,
  });
  try {
    injectSplashVersion({ packageJsonPath: fx.pkg, splashPath: fx.splash });
    const after = readFileSync(fx.splash, "utf8");
    assert.match(after, /\{\{OTHER_TOTHER\}\}/, "其他占位符应原样保留");
    assert.match(after, /<span class="version">v0\.4\.0<\/span>/);
  } finally {
    cleanup(fx.dir);
  }
}

// 8. 文件里没有 version span:noop(保护手写 markup)
{
  const fx = makeFixture({
    version: "0.4.0",
    splashBody: '<html><div class="footer">fromlan</div></html>',
  });
  try {
    const before = readFileSync(fx.splash, "utf8");
    const r = injectSplashVersion({
      packageJsonPath: fx.pkg,
      splashPath: fx.splash,
    });
    assert.equal(r.kind, "noop");
    const after = readFileSync(fx.splash, "utf8");
    assert.equal(after, before, "找不到 version span 时不应修改文件");
  } finally {
    cleanup(fx.dir);
  }
}

// 9. 版本 span 改写保留额外属性/前后 markup
//    确保脚本不会把 `<span class="version" data-x>` 之类未来扩展属性吞掉。
{
  const fx = makeFixture({
    version: "0.4.1",
    splashBody: '<div><span class="version" data-x="y">v0.3.12</span> · meta</div>',
  });
  try {
    injectSplashVersion({ packageJsonPath: fx.pkg, splashPath: fx.splash });
    const after = readFileSync(fx.splash, "utf8");
    assert.match(after, /data-x="y"/, "额外属性应保留");
    assert.match(after, /<span class="version" data-x="y">v0\.4\.1<\/span>/);
    assert.match(after, /· meta/, "span 之后的文本应保留");
  } finally {
    cleanup(fx.dir);
  }
}

console.log("test-inject-splash-version: ok");