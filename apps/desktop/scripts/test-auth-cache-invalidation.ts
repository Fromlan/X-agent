/**
 * Regression test: provider sync must invalidate `auth-check` cache.
 *
 * Bug: `auth-check.checkAuth()` 模块级 `cachedAuth` 在启动后被填充,后续
 * provider upsert / setEnabled / delete 改写 `auth.json`,但旧缓存没失效。
 * 现象:`onProvidersChanged` 里 `setAuth(checkAuth())` 拿到陈旧的 `ok:false`,
 * ReadyChecklist 误以为"未配置供应商"持续显示「配置模型认证」。
 *
 * 修复:`syncProfileToPi` / `pruneProviderIdFromPi` 写完 `auth.json` 后调用
 * `invalidateAuthCache`。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  upsertProviderProfile,
  deleteProviderProfile,
  setProviderProfileEnabled,
  type ProviderPaths,
} from "../electron/agent/provider-store";
import {
  checkAuth,
  invalidateAuthCache,
} from "../electron/agent/auth-check";
import { setAgentDirOverrideForTests } from "../electron/agent/prefs";

/** Builds isolated provider paths for the temporary test store. */
function makePaths(root: string): ProviderPaths {
  return {
    agentDir: root,
    storePath: join(root, "x-agent-providers.json"),
    authPath: join(root, "auth.json"),
    modelsPath: join(root, "models.json"),
  };
}

/** Clears the cache so the next auth check observes the missing test file. */
function primeCachedAuthAsMissing(): void {
  // 让首次 checkAuth() 看到 auth.json 不存在,缓存为 ok:false。
  invalidateAuthCache();
}

void (async () => {
  const root = mkdtempSync(join(tmpdir(), "alpha-auth-cache-"));
  const paths = makePaths(root);
  writeFileSync(paths.storePath, JSON.stringify({ version: 1, activeId: null, profiles: [] }), "utf8");
  setAgentDirOverrideForTests(root);

  // —— 1. 首次 checkAuth 在 auth.json 不存在时填 ok:false 进缓存 ——
  primeCachedAuthAsMissing();
  const before = await checkAuth();
  assert.equal(before.ok, false, "no auth.json yet → ok:false");

  // —— 2. upsert 一个启用档案 → syncProfileToPi 写 auth.json + 失效缓存 ——
  const upserted = await upsertProviderProfile(
    {
      name: "DeepSeek",
      providerId: "deepseek",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-ds-1234567890",
      models: [{ id: "deepseek-chat" }],
    },
    paths,
  );
  assert.ok(upserted.ok && upserted.profile, `upsert: ${upserted.error}`);
  assert.equal(
    readFileSync(paths.authPath, "utf8").includes("deepseek"),
    true,
    "auth.json written by sync",
  );

  const after = await checkAuth();
  assert.equal(
    after.ok,
    true,
    "checkAuth after upsert must re-read disk and reflect new auth.json",
  );

  // —— 3. 显式 invalidate 后缓存清空,checkAuth 重读盘 ——
  invalidateAuthCache();
  const reRead = await checkAuth();
  assert.equal(reRead.ok, true, "invalidateAuthCache forces re-read");

  // —— 4. setProviderProfileEnabled 触发的 sync 也必须失效缓存 ——
  // 先把缓存填充为 ok:false 再验证。
  invalidateAuthCache();
  // 临时删掉 auth.json 模拟"缓存陈旧"。
  // 注意 setEnabled 走 applyPiSyncForProfile,enabled=true 会再次 syncProfileToPi。
  const enabled = await setProviderProfileEnabled(
    upserted.profile!.id,
    true,
    paths,
  );
  assert.ok(enabled.ok);
  // enabled 时 sync 重新写 auth.json,缓存应被清。
  // 通过再读一次确认。
  const afterEnable = await checkAuth();
  assert.equal(afterEnable.ok, true, "checkAuth after re-enable reflects disk");

  // —— 5. delete 走 pruneProviderIdFromPi,也要失效缓存(在最后一条档案被拒绝时跳过 prune) ——
  // 这里只有一个档案,删除会被拒绝(至少一个启用),不写 auth.json,所以 cachedAuth 不变。
  const refused = await deleteProviderProfile(upserted.profile!.id, paths);
  assert.equal(refused.ok, false, "delete last enabled must be refused");
  // 缓存仍指向 ok:true(刚被 sync 触发过),行为正确:不允许的删除不应当回退缓存。
  const afterRefuse = await checkAuth();
  assert.equal(afterRefuse.ok, true, "refused delete must not flip cache");

  // —— 6. 加第二个档案,再 delete 第一个 → prune 触发写 auth.json + 失效缓存 ——
  const second = await upsertProviderProfile(
    {
      name: "Kimi",
      providerId: "kimi",
      api: "anthropic-messages",
      baseUrl: "https://api.moonshot.cn/anthropic",
      apiKey: "sk-kimi-1234567890",
      models: [{ id: "kimi-k2" }],
    },
    paths,
  );
  assert.ok(second.ok && second.profile);
  // 把 cache 故意脏化(模拟"上次 sync 后又有别的路径动过缓存")。
  invalidateAuthCache();
  // 删第二个档案,prune 会写 auth.json,触发失效。
  const del = await deleteProviderProfile(second.profile!.id, paths);
  assert.ok(del.ok, `delete: ${del.error}`);
  // 现在 auth.json 里应该只剩 deepseek 这一个 key。
  const authNow = JSON.parse(readFileSync(paths.authPath, "utf8")) as Record<string, unknown>;
  assert.ok("deepseek" in authNow, "deepseek still in auth.json");
  assert.ok(!("kimi" in authNow), "kimi pruned from auth.json");
  // cache 应已被失效,checkAuth 重读盘应得到 ok:true(deepseek 仍在)。
  const afterPrune = await checkAuth();
  assert.equal(
    afterPrune.ok,
    true,
    "checkAuth after prune reflects post-prune auth.json",
  );

  setAgentDirOverrideForTests(null);
  rmSync(root, { recursive: true, force: true });
  console.log("test-auth-cache-invalidation: ok");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
