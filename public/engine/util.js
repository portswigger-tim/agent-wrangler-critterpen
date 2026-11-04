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
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
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
  let lo = 0, hi = text.length;
  // Binary search on the longest prefix that fits with the ellipsis.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(text.slice(0, mid).trimEnd() + ell) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + ell;
}

/**
 * Like truncateToWidth, but cuts from the middle so both ends survive: the
 * tail of a session name is often what tells two apart. Whole words are
 * dropped from the middle, keeping the first and last ("Investigate … timeouts");
 * only a name that can't keep two whole words is cut inside a word.
 * @param {string} text
 * @param {number} maxWidth
 * @param {(s: string) => number} measure
 */
export function truncateMiddle(text, maxWidth, measure) {
  if (measure(text) <= maxWidth) return text;
  const ell = '…';
  if (measure(ell) > maxWidth) return '';
  const words = text.trim().split(/\s+/);
  const last = words[words.length - 1];
  if (words.length >= 3) {
    const join = (h, t) => `${words.slice(0, h).join(' ')} ${ell} ${words.slice(words.length - t).join(' ')}`;
    if (measure(join(1, 1)) <= maxWidth) {
      let head = 1, tail = 1;
      // Grow from the tail first (it tells sessions apart), always dropping at least one word.
      for (;;) {
        if (head + tail + 1 < words.length && measure(join(head, tail + 1)) <= maxWidth) tail++;
        else if (head + tail + 1 < words.length && measure(join(head + 1, tail)) <= maxWidth) head++;
        else break;
      }
      return join(head, tail);
    }
  }
  // Still too long: keep the last word whole and shorten the first ("Inves… timeouts").
  if (words.length >= 2 && measure(`${words[0][0]}${ell} ${last}`) <= maxWidth) {
    let n = words[0].length - 1;
    while (n > 1 && measure(`${words[0].slice(0, n)}${ell} ${last}`) > maxWidth) n--;
    return `${words[0].slice(0, n)}${ell} ${last}`;
  }
  const fit = (n) => {
    const head = Math.ceil(n * 0.4), tail = n - head;
    return text.slice(0, head).trimEnd() + ell + (tail ? text.slice(text.length - tail).trimStart() : '');
  };
  let lo = 0, hi = text.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(fit(mid)) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return fit(lo);
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
