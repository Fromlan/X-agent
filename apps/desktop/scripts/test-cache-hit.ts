import {
  cacheHitRatio,
  formatCacheHitRatio,
} from "../shared/cache-hit";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(cacheHitRatio({ input: 0, cacheRead: 0 }) === null, "empty → null");
assert(
  cacheHitRatio({ input: 1546, cacheRead: 7296 }) === 7296 / (1546 + 7296),
  "hit ratio = cacheRead / (input + cacheRead)",
);
assert(cacheHitRatio({ input: 100, cacheRead: 0 }) === 0, "no cache → 0");
assert(cacheHitRatio({ input: 0, cacheRead: 500 }) === 1, "all cache → 1");
assert(
  formatCacheHitRatio(null) === "—",
  "null formats as em dash",
);
assert(
  formatCacheHitRatio(0.82) === "82%",
  "large percent rounded",
);
assert(
  formatCacheHitRatio(0.05) === "5.0%",
  "small percent one decimal",
);

console.log("test-cache-hit: ok");
