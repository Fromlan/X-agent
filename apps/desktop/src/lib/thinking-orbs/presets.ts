/**
 * Preset resolution for the orb engine — ported from thinking-orbs
 * (https://github.com/Jakubantalik/thinking-orbs), MIT © Jakub Antalik.
 * Ships the orbits (working), wave (listening), web (connecting) and
 * ring (breathing) modes at the two tuned sizes; the ModeKey registry
 * structure stays so future states can slot in. Resolved once per
 * (state, size) pair and cached — the render loop sees plain numbers.
 */

import type { ModeOpts } from "./core";
import { drawOrbits } from "./orbits";
import { drawWave } from "./lattice";
import { drawWeb } from "./web";
import { drawRibbon } from "./ribbon";

export type ModeKey = "orbits" | "wave" | "web" | "ring";

export type OrbState = "working" | "listening" | "connecting" | "breathing";

export type OrbSize = 20 | 64;

export const STATE_TO_MODE: Record<OrbState, ModeKey> = {
  working: "orbits",
  listening: "wave",
  connecting: "web",
  breathing: "ring",
};

export const MODE_DRAWS: Record<
  ModeKey,
  (typeof drawOrbits) | (typeof drawWave) | (typeof drawWeb) | (typeof drawRibbon)
> = {
  orbits: drawOrbits,
  wave: drawWave,
  web: drawWeb,
  // ring shares ribbon's painter — the `faceOn` profile flag switches it
  ring: drawRibbon,
};

// Density profiles per mode (inkform `fine` tuning base), before preset
// multipliers are applied on top.
const BASE_PROFILES: Record<ModeKey, ModeOpts> = {
  orbits: {
    orbitN: 12,
    ghostN: 40,
    ghostR: 0.9,
    ghostA: 0.5,
    particles: 3,
    partR: 1.2,
    partRDepth: 1.6,
    rsPow: 0.6,
    rMin: 0.3,
  },
  wave: {
    rings: 15,
    lonDensity: 40,
    rBase: 0.6,
    rDepth: 1.7,
    rsPow: 0.6,
    rMin: 0.3,
  },
  web: {
    nodeN: 30,
    thr: 0.72,
    signals: 5,
    nodeR: 1.4,
    nodeRDepth: 1.8,
    lineW: 0.8,
    rsPow: 0.6,
    rMin: 0.3,
  },
  // ring shares ribbon's painter; faceOn cancels the camera tilt and moves
  // the undulation onto the radius, and there is no ghost sphere behind it
  ring: {
    lanes: 5,
    segs: 88,
    ghostN: 0,
    faceOn: 1,
    rBase: 1.1,
    rDepth: 1.7,
    rsPow: 0.6,
    rMin: 0.3,
  },
};

// 2-D lattices (rings × dots-per-ring) come in pairs — each side takes
// √scale so the TOTAL dot count scales by `scale`; flat lists scale
// linearly.
const COUNT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["rings", "lonDensity"],
  ["lanes", "segs"],
];
const COUNT_KEYS = ["orbitN", "ghostN", "nodeN", "signals"] as const;

const RADIUS_KEYS = [
  "ghostR",
  "partR",
  "partRDepth",
  "rBase",
  "rDepth",
  "nodeR",
  "nodeRDepth",
] as const;

interface Preset {
  speed: number;
  count: number;
  size: number;
  /** Extra mode opts merged verbatim after scaling. */
  extra?: ModeOpts;
}

const PRESETS: Record<ModeKey, Record<OrbSize, Preset>> = {
  orbits: {
    64: { speed: 1.885, count: 1, size: 1 },
    20: { speed: 3.9, count: 0.238, size: 2.4 },
  },
  wave: {
    64: { speed: 4.388, count: 0.341, size: 1 },
    20: { speed: 3.998, count: 0.105, size: 1.6 },
  },
  web: {
    64: { speed: 3.315, count: 1.35, size: 0.95 },
    20: { speed: 6.63, count: 0.25, size: 1.52 },
  },
  ring: {
    64: {
      speed: 3.24,
      count: 0.25,
      size: 0.956,
      extra: { spin: 0, bandMul: 3.627, wobMul: 0.368 },
    },
    20: {
      speed: 3.78,
      count: 0.028,
      size: 1.622,
      extra: { spin: 0, bandMul: 3.968, wobMul: 0.565 },
    },
  },
};

export interface Resolved {
  mode: ModeKey;
  speed: number;
  opts: ModeOpts;
}

function scaleCounts(opts: ModeOpts, scale: number): ModeOpts {
  const out: ModeOpts = { ...opts };
  const done = new Set<string>();
  const rt = Math.sqrt(scale);
  for (const [a, b] of COUNT_PAIRS) {
    const va = out[a];
    const vb = out[b];
    if (va != null && vb != null && !done.has(a) && !done.has(b)) {
      out[a] = Math.max(2, Math.round(va * rt));
      out[b] = Math.max(2, Math.round(vb * rt));
      done.add(a);
      done.add(b);
    }
  }
  for (const k of COUNT_KEYS) {
    const v = out[k];
    // 0 means the mode opted out of that layer entirely — scaling must
    // not resurrect it as a single stray dot
    if (v != null && v !== 0 && !done.has(k)) out[k] = Math.max(1, Math.round(v * scale));
  }
  return out;
}

function scaleRadii(opts: ModeOpts, scale: number): ModeOpts {
  const out: ModeOpts = { ...opts };
  for (const k of RADIUS_KEYS) {
    const v = out[k];
    if (v != null) out[k] = v * scale;
  }
  return out;
}

const cache = new Map<string, Resolved>();

/** Resolve a (state, size) pair to its mode + fully-scaled draw options. */
export function resolvePreset(state: OrbState, size: OrbSize): Resolved {
  const key = `${state}-${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const mode = STATE_TO_MODE[state];
  const preset = PRESETS[mode][size];
  let opts: ModeOpts = { ...BASE_PROFILES[mode] };
  if (preset.count !== 1) opts = scaleCounts(opts, preset.count);
  if (preset.size !== 1) opts = scaleRadii(opts, preset.size);
  if (preset.extra) opts = { ...opts, ...preset.extra };

  const resolved: Resolved = { mode, speed: preset.speed, opts };
  cache.set(key, resolved);
  return resolved;
}
