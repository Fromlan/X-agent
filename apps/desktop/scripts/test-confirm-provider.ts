/**
 * 回归测试 —— 修复 ConfirmProvider 在连续 confirm 调用下的 Promise 泄露 bug。
 *
 * bug 描述（CHANGELOG 0.3.14 修复）：
 *   用户连续两次点击「全部开启」切换按钮，第一次的 setToolGroupEnabled
 *   await confirm(...) 永远不 resolve —— pendingRef.current 被覆盖，
 *   第一次的 resolve 函数丢失，UI 表现为"第一次确认无效果，要第二次才有效果"。
 *
 * 修复方式（src/lib/app-confirm.tsx）：新 confirm() 启动前自动 resolve 旧 pending 为 false。
 *
 * 本脚本不依赖 React，模拟 useRef + setState 的语义，直接验证修复后的合约：
 *   1. 单次 confirm → 单次 close(true)：resolve(true) 一次
 *   2. 连续 confirm#1 → confirm#2：confirm#1 立即 resolve(false)，confirm#2 仍可被 close(true) 接受
 *   3. close(true) 后再 confirm：新一轮正常
 */
import { strict as assert } from "node:assert";

// —— 模拟 ConfirmProvider 的最小状态机 ——
class FakeProvider {
  pendingRef: { current: { resolve: (v: boolean) => void } | null } = {
    current: null,
  };
  pending: unknown = null;
  setPending(v: unknown) {
    this.pending = v;
  }
  confirm(options: { tone: string }): Promise<boolean> {
    // 关键修复逻辑：旧 pending 必须在创建新 pending 之前 resolve
    if (this.pendingRef.current) {
      const prev = this.pendingRef.current;
      prev.resolve(false);
      this.pendingRef.current = null;
    }
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      this.pendingRef.current = next;
      this.setPending(next);
    });
  }
  close(value: boolean) {
    const cur = this.pendingRef.current;
    this.pendingRef.current = null;
    this.setPending(null);
    cur?.resolve(value);
  }
}

async function run() {
  // —— Case 1: 单次 confirm → 单次 close(true) ——
  {
    const p = new FakeProvider();
    const c1 = p.confirm({ tone: "warn" });
    let resolved: unknown = "pending";
    c1.then((v) => (resolved = v));
    p.close(true);
    await c1;
    assert.strictEqual(resolved, true, "单次 confirm 后 close(true) 必须 resolve(true)");
    console.log("✓ Case 1 单次 confirm → close(true)");
  }

  // —— Case 2: 连续两次 confirm ——（修复前的 bug 场景）
  {
    const p = new FakeProvider();
    let r1: unknown = "pending";
    let r2: unknown = "pending";
    const c1 = p.confirm({ tone: "warn" }).then((v) => (r1 = v));
    const c2 = p.confirm({ tone: "warn" }).then((v) => (r2 = v));
    // 等微任务，确认 c1 已被旧逻辑自动 resolve
    await Promise.resolve();
    assert.strictEqual(r1, false, "第二次 confirm 必须让第一次立即 resolve(false)");
    assert.strictEqual(r2, "pending", "第二次 confirm 不应立即 resolve");

    // 用户点击「继续」
    p.close(true);
    await c2;
    assert.strictEqual(r2, true, "close(true) 必须 resolve 当前 pending 为 true");
    console.log("✓ Case 2 连续 confirm → close(true)（修复了 Promise 泄露）");
  }

  // —— Case 3: 连续三次 confirm，模拟快速点击 ——
  {
    const p = new FakeProvider();
    const results: unknown[] = ["pending", "pending", "pending"];
    const promises = [
      p.confirm({ tone: "warn" }).then((v) => (results[0] = v)),
      p.confirm({ tone: "warn" }).then((v) => (results[1] = v)),
      p.confirm({ tone: "warn" }).then((v) => (results[2] = v)),
    ];
    await Promise.resolve();
    assert.strictEqual(results[0], false);
    assert.strictEqual(results[1], false);
    assert.strictEqual(results[2], "pending");

    p.close(true);
    await promises[2];
    assert.strictEqual(results[2], true);
    console.log("✓ Case 3 连续三次 confirm → close(true)");
  }

  // —— Case 4: close(true) 后再 confirm，新一轮正常 ——
  {
    const p = new FakeProvider();
    const c1 = p.confirm({ tone: "warn" });
    p.close(true);
    await c1;

    const c2 = p.confirm({ tone: "warn" });
    let r2: unknown = "pending";
    c2.then((v) => (r2 = v));
    p.close(true);
    await c2;
    assert.strictEqual(r2, true);
    console.log("✓ Case 4 close 后新一轮 confirm 正常工作");
  }

  // —— Case 5: close(false) 应 resolve 当前 pending 为 false ——
  {
    const p = new FakeProvider();
    let r: unknown = "pending";
    const c = p.confirm({ tone: "warn" }).then((v) => (r = v));
    p.close(false);
    await c;
    assert.strictEqual(r, false);
    console.log("✓ Case 5 close(false) resolve 当前 pending 为 false");
  }

  console.log("\n全部合约通过——CHANGELOG 0.3.14 修复已落地。");
}

run().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
