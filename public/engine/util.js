// Small pure helpers: hashing, seeded randomness, easing, maths, text fitting.

/**
 * FNV-1a 32-bit hash of a string. Deterministic across runs and platforms.
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // MurmurHash3 fmix32 avalanche so ids that differ in one char (or share a
  // long prefix, like UUIDs from one machine) still spread across every bit.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Stable per-critter looks derived from its id. Each trait is its own draw
 * from a seeded PRNG, so sharing one (say the same hat) says nothing about
 * the others (tint, hop rhythm, size).
 * @param {string} id
 * @param {number} accessoryCount
 */
export function critterTraits(id, accessoryCount) {
  const seed = hash32(id);
  const r = rng(seed);
  return {
    seed,
    accessory: Math.floor(r() * accessoryCount),
    hue: Math.floor(r() * 360),
    hop: Math.floor(r() * 7),
    phase: r() * 10,
    size: 0.92 + r() * 0.16,
  };
}

/**
 * Mulberry32 PRNG. Returns a function producing floats in [0, 1).
 * @param {number} seed
 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

/** Easing functions, all map [0,1] → [0,1] with f(0)=0 and f(1)=1. */
export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158,
      c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
};

/**
 * Advance a critically-damped-ish spring one step toward `target`.
 * Mutates and returns `s` ({ x, v }). Stable for any dt (sub-steps large dt).
 * @param {{x:number, v:number}} s
 * @param {number} target
 * @param {number} dt seconds
 * @param {number} [stiffness]
 * @param {number} [damping]
 */
export function springStep(s, target, dt, stiffness = 90, damping = 2 * Math.sqrt(90)) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = stiffness * (target - s.x) - damping * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
  return s;
}

/**
 * Truncate `text` with an ellipsis so `measure(result) <= maxWidth`.
 * @param {string} text
 * @param {number} maxWidth
 * @param {(s: string) => number} measure
 */
export function truncateToWidth(text, maxWidth, measure) {
  if (measure(text) <= maxWidth) return text;
  const ell = '…';
  if (measure(ell) > maxWidth) return '';
  let lo = 0,
    hi = text.length;
  // Binary search on the longest prefix that fits with the ellipsis.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(text.slice(0, mid).trimEnd() + ell) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + ell;
}

/** Fewest characters kept on a side of a cut inside a word: shorter is a fragment. */
export const MIN_CUT = 4;

/**
 * Shorten a name from the middle so both ends survive: the tail of a session
 * name is often what tells two apart. In order of preference:
 *  1. drop whole middle words, keeping the first and last ("Investigate … timeouts");
 *  2. keep the last word whole and cut the first, keeping ≥ MIN_CUT of it ("Inves… timeouts");
 *  3. the first whole word ("Investigate…");
 *  4. a cut inside a single word, ≥ MIN_CUT each side ("Safe…tion"), or just its start ("Safe…");
 *  5. nothing, rather than a fragment.
 * It never cuts inside both end words.
 * @param {string} text
 * @param {number} maxWidth
 * @param {(s: string) => number} measure
 */
export function truncateMiddle(text, maxWidth, measure) {
  if (measure(text) <= maxWidth) return text;
  const ell = '…';
  const fits = (t) => measure(t) <= maxWidth;
  const words = text.trim().split(/\s+/);
  const first = words[0],
    last = words[words.length - 1];
  if (words.length >= 3) {
    const join = (h, t) => `${words.slice(0, h).join(' ')} ${ell} ${words.slice(words.length - t).join(' ')}`;
    if (fits(join(1, 1))) {
      let head = 1,
        tail = 1;
      // Grow from the tail first (it tells sessions apart), always dropping at least one word.
      for (;;) {
        if (head + tail + 1 < words.length && fits(join(head, tail + 1))) tail++;
        else if (head + tail + 1 < words.length && fits(join(head + 1, tail))) head++;
        else break;
      }
      return join(head, tail);
    }
  }
  if (words.length >= 2) {
    for (let n = first.length - 1; n >= MIN_CUT; n--) {
      const t = `${first.slice(0, n)}${ell} ${last}`;
      if (fits(t)) return t;
    }
    if (fits(`${first}${ell}`)) return `${first}${ell}`;
  }
  // One word left to work with (or the first word alone is too long).
  const w = words.length >= 2 ? first : text.trim();
  for (let n = w.length - 1; n >= 2 * MIN_CUT; n--) {
    const head = Math.max(MIN_CUT, Math.ceil(n * 0.45)),
      tail = n - head;
    if (tail < MIN_CUT) continue;
    const t = `${w.slice(0, head)}${ell}${w.slice(w.length - tail)}`;
    if (words.length === 1 && fits(t)) return t;
  }
  for (let n = w.length - 1; n >= MIN_CUT; n--) {
    const t = `${w.slice(0, n)}${ell}`;
    if (fits(t)) return t;
  }
  return '';
}

/** Point on a quadratic bezier. */
export function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

/** Tangent angle of a quadratic bezier at t. */
export function quadAngle(p0, p1, p2, t) {
  const dx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const dy = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
  return Math.atan2(dy, dx);
}

/**
 * Control point for a nice throwing arc from a to b: midpoint lifted "up" (−y),
 * clamped so it stays inside the canvas.
 */
export function arcControl(a, b, minY = 4) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const lift = Math.max(40, dist * 0.45);
  return { x: (a.x + b.x) / 2, y: Math.max(minY, Math.min(a.y, b.y) - lift) };
}
