/**
 * 把 package.json 的 version 同步到 public/splash.html 的版本号显示位。
 *
 * 设计要点:
 * - 单一源真值:apps/desktop/package.json 的 `version` 字段是唯一权威,
 *   启动画面右下角的 `v...` 必须与之一致(发布时也通过 electron-builder
 *   写入到安装包 manifest)。
 * - 占位符优先:`<span class="version">{{X_AGENT_VERSION}}</span>` 作为源代码里的标记;
 *   首次构建后会被替换为字面量 `vX.Y.Z`,后续运行识别为已就绪 → noop。
 * - 自动跟进 npm version patch:即使历史 commit 把 v0.4.0 字面量留在了文件里,
 *   一旦 package.json 升到 0.4.1,脚本会改写 `<span class="version">` 内的版本字面量,
 *   避免「版本号漏更新」这种发布前常踩的坑。
 * - checkOnly 模式:CI / pre-release 检查用,版本对不上时返回非零退出码。
 *
 * 双轨覆盖:
 *   - 开发模式 electron-vite dev → loadFile 直接读 `public/splash.html`,
 *   - 生产模式 electron-vite build → Vite publicDir 把同一份 `public/splash.html`
 *     拷贝到 `out/renderer/splash.html`,本脚本只改源文件,build 自动跟随。
 *
 * 接入方式: package.json 的 predev / prebuild 钩子在 electron-vite 启动前调用本脚本。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 占位符标记;首次注入或被有意 reset 后,源文件应回到此标记。 */
export const PLACEHOLDER = "{{X_AGENT_VERSION}}";

/** splash.html 内承载版本号的 span 容器;脚本只在该容器内改写,不碰其他文本。 */
const VERSION_SPAN_RE = /(<span class="version"[^>]*>)([^<]*)(<\/span>)/;

export interface InjectOptions {
  /** splash.html 路径;默认指向 apps/desktop/public/splash.html */
  splashPath?: string;
  /** package.json 路径;默认指向 apps/desktop/package.json */
  packageJsonPath?: string;
  /** true 时不修改文件,版本对不上时返回 `mismatch`(runCli 退出码 2) */
  checkOnly?: boolean;
}

export type InjectResult =
  | { kind: "wrote"; version: string }
  | { kind: "noop"; version: string }
  | { kind: "mismatch"; version: string; fileVersion: string };

/**
 * 读取 package.json + splash.html,把版本号同步成 `v${pkg.version}`。
 *
 * - placeholder 命中 → 替换为字面量
 * - placeholder 不在 + 当前文件已含正确版本 → noop
 * - placeholder 不在 + 当前文件版本与 package.json 不一致 → 改写 span 内的版本字面量
 *   (default 模式),或在 checkOnly 模式下返回 mismatch(不写文件)
 * - placeholder 不在 + 文件里根本没有版本 span → noop(避免破坏手工修改的样式)
 *
 * 异常情形抛 Error:package.json 解析失败 / splash.html 不可读等。
 */
export function injectSplashVersion(options: InjectOptions = {}): InjectResult {
  const splashPath = options.splashPath ?? join(__dirname, "..", "public", "splash.html");
  const packageJsonPath = options.packageJsonPath ?? join(__dirname, "..", "package.json");

  const pkgRaw = readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(pkgRaw) as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(`${packageJsonPath} 缺少合法的 version 字段`);
  }
  const versionText = `v${pkg.version}`;

  const original = readFileSync(splashPath, "utf8");

  // 路径 A:占位符还在 → 直接替换
  if (original.includes(PLACEHOLDER)) {
    if (options.checkOnly) {
      // checkOnly 模式下占位符仍存在 → 文件尚未同步,视作 mismatch 等价失败
      return { kind: "mismatch", version: versionText, fileVersion: PLACEHOLDER };
    }
    const updated = original.split(PLACEHOLDER).join(versionText);
    writeFileSync(splashPath, updated, "utf8");
    return { kind: "wrote", version: versionText };
  }

  // 路径 B/C:占位符不在 → 看 version span 内的字面量
  const m = original.match(VERSION_SPAN_RE);
  if (!m) {
    // 文件里没有版本 span,保留不动(避免误改其他 markup)。
    return { kind: "noop", version: versionText };
  }
  const fileVersion = m[2] ?? "";
  if (fileVersion === versionText) {
    return { kind: "noop", version: versionText };
  }
  if (options.checkOnly) {
    return { kind: "mismatch", version: versionText, fileVersion };
  }
  // 路径 C:版本字面量与 package.json 不一致 → 改写 span 内容,保留 span 前后 markup。
  const updated = original.replace(
    VERSION_SPAN_RE,
    (_full, open: string, _old: string, close: string) => `${open}${versionText}${close}`,
  );
  writeFileSync(splashPath, updated, "utf8");
  return { kind: "wrote", version: versionText };
}

/** 进程退出码:成功 0,异常 1,checkOnly 检测到 mismatch 2。 */
export function runCli(argv: readonly string[] = process.argv.slice(2)): number {
  const checkOnly = argv.includes("--check-only");
  let result: InjectResult;
  try {
    result = injectSplashVersion({ checkOnly });
  } catch (err) {
    console.error(
      "[inject-splash-version] failed:",
      err instanceof Error ? err.message : String(err),
    );
    return 1;
  }
  switch (result.kind) {
    case "wrote":
      console.log(`[inject-splash-version] injected ${result.version}`);
      return 0;
    case "noop":
      console.log(`[inject-splash-version] no-op (${result.version})`);
      return 0;
    case "mismatch":
      console.error(
        `[inject-splash-version] mismatch: package.json=${result.version}, splash.html=${result.fileVersion}`,
      );
      return 2;
  }
}

// 入口判定:仅当被 Node 直接执行时启动 CLI;被 import 时只导出 API。
const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryHref && import.meta.url === entryHref) {
  process.exit(runCli());
}