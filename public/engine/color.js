// Colour parsing, mixing and theme-token reading.
// Everything except readTheme() is pure and runs in Node.

/** @typedef {{ r: number, g: number, b: number, a: number }} RGBA */

export const TOKENS = ['green', 'blue', 'yellow', 'red', 'surface-2', 'fg', 'bg', 'accent'];

/** Fallback variable names (the wrangler's core themes call amber `--warn`). */
const ALIASES = { yellow: 'warn' };

export const FALLBACKS = {
  light: {
    green: '#3fb950',
    blue: '#4c8dff',
    yellow: '#f2b01e',
    red: '#ef5350',
    'surface-2': '#c9ced6',
    fg: '#1f2328',
    bg: '#f6f7f9',
    accent: '#a371f7',
  },
  dark: {
    green: '#56d364',
    blue: '#6ca7ff',
    yellow: '#f5c542',
    red: '#ff6b6b',
    'surface-2': '#3a414b',
    fg: '#e6edf3',
    bg: '#14171c',
    accent: '#bc8cff',
  },
};

/**
 * Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba() (comma or space syntax).
 * Returns null for anything else (the browser path rasterises those instead).
 * @param {string} str
 * @returns {RGBA|null}
 */
export function parseColor(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a = 'f'] = h.split('');
      return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16), a: parseInt(a + a, 16) / 255 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  m = s.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const ch = (v) => (v.endsWith('%') ? (parseFloat(v) * 255) / 100 : parseFloat(v));
    const al = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: ch(m[1]), g: ch(m[2]), b: ch(m[3]), a: al };
  }
  return null;
}

/** @param {RGBA} c @param {number} [alpha] multiplies c.a */
export function toCss(c, alpha = 1) {
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+(c.a * alpha).toFixed(3)})`;
}

/** Linear mix a→b by t. @returns {RGBA} */
export function mix(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t };
}

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };
export const lighten = (c, t) => mix(c, WHITE, t);
export const darken = (c, t) => mix(c, BLACK, t);

/** WCAG relative luminance, 0..1. */
export function luminance(c) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a, b) {
  const la = luminance(a),
    lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Nudge `c` away from `bg` (lighter on dark backgrounds, darker on light ones)
 * until the contrast reaches `min`, so grey critters never vanish into the floor.
 */
export function ensureContrast(c, bg, min = 1.6) {
  const toward = luminance(bg) < 0.4 ? WHITE : BLACK;
  let out = c;
  for (let t = 0; t <= 1 && contrast(out, bg) < min; t += 0.05) out = mix(c, toward, t);
  return out;
}

/** True when the palette background is dark. */
export const isDark = (bg) => luminance(bg) < 0.4;

/**
 * Resolve palette strings into RGBA, using `resolve` for anything parseColor
 * can't handle (oklch(), named colours…) and falling back per token.
 * @param {Record<string,string>} raw token → css string ('' when unset)
 * @param {'light'|'dark'} mode which fallback set to use
 * @param {(css: string) => RGBA|null} [resolve]
 * @returns {Record<string, RGBA>}
 */
export function resolvePalette(raw, mode, resolve = () => null) {
  const fb = FALLBACKS[mode];
  const out = {};
  for (const k of TOKENS) {
    const v = (raw[k] || '').trim();
    out[k] = (v && (parseColor(v) || resolve(v))) || parseColor(fb[k]);
  }
  return out;
}

let probe = null;
/** Rasterise any CSS colour via a 1×1 canvas (browser only). */
function rasterise(css) {
  try {
    if (!probe) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  } catch {
    return null;
  }
}

/**
 * Read theme tokens from CSS custom properties on `el` (browser only).
 * @param {Element} el
 * @param {'auto'|'light'|'dark'} theme
 */
export function readTheme(el, theme = 'auto') {
  const cs = getComputedStyle(el);
  const raw = {};
  for (const k of TOKENS) raw[k] = cs.getPropertyValue(`--${k}`) || cs.getPropertyValue(`--${ALIASES[k] || k}`);
  let mode = theme;
  if (mode === 'auto') {
    const bg = raw.bg && (parseColor(raw.bg) || rasterise(raw.bg));
    mode = bg ? (isDark(bg) ? 'dark' : 'light') : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  const pal = resolvePalette(raw, /** @type {'light'|'dark'} */ (mode), rasterise);
  return { ...pal, dark: isDark(pal.bg) };
}

/** RGBA → { h: 0..360, s: 0..1, l: 0..1, a }. */
export function rgbToHsl(c) {
  const r = c.r / 255,
    g = c.g / 255,
    b = c.b / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2,
    d = max - min;
  if (d === 0) return { h: 0, s: 0, l, a: c.a };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l, a: c.a };
}

/** HSL (0..360, 0..1, 0..1) → RGBA. */
export function hslToRgb(h, s, l, a = 1) {
  const k = (n) => (n + h / 30) % 12;
  const q = s * Math.min(l, 1 - l);
  const f = (n) => l - q * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a };
}

const clamp01 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Soften a theme colour into the critters' pastel range: same hue, a little
 * less saturation, lightness squeezed into a band that suits the background.
 * Greys stay grey. On light themes the band sits lower so bodies keep their
 * edge against a pale floor.
 * @param {RGBA} c
 * @param {boolean} dark palette background is dark
 */
export function pastel(c, dark) {
  const { h, s, l, a } = rgbToHsl(c);
  const L = dark ? clamp01(0.3 + l * 0.55, 0.64, 0.8) : clamp01(0.26 + l * 0.55, 0.58, 0.72);
  const S = s < 0.2 ? s * 0.9 : clamp01(s * (dark ? 0.78 : 0.82), 0.32, dark ? 0.68 : 0.72);
  return hslToRgb(h, S, L, a);
}

/** Smallest angle between two hues, 0..180. */
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Darker, slightly warmer, more saturated cousin of a body colour for the
 * critter's outline and feet: reads as "the same thing, in shadow".
 */
export function inkFor(c, amount = 0.42) {
  const { h, s, l, a } = rgbToHsl(c);
  const toward = s < 0.08 ? h : h + (h > 60 && h < 240 ? 12 : -10); // nudge toward violet/red, never toward mud
  return hslToRgb((toward + 360) % 360, Math.min(0.72, s * 0.95 + 0.06), l * (1 - amount), a);
}

const restGrey = (pal) => (pal.dark ? mix(pal['surface-2'], pal.fg, 0.42) : mix(pal['surface-2'], pal.bg, 0.15));

/**
 * Body colour for a critter status in a palette from readTheme(): the status
 * token, pastel-tuned. Idle/asleep are soft greys (asleep a hint bluer),
 * finished leans toward the accent.
 * @param {string} status
 * @param {Record<string, RGBA> & { dark: boolean }} pal
 */
export function statusColor(status, pal) {
  const dark = !!pal.dark;
  switch (status) {
    case 'working':
      return pastel(pal.green, dark);
    case 'thinking':
      return pastel(pal.blue, dark);
    case 'needs-you':
      return pastel(pal.yellow, dark);
    case 'error':
      return pastel(pal.red, dark);
    case 'archived':
      return ensureContrast(mix(pal['surface-2'], pal.bg, 0.25), pal.bg, 1.3);
    case 'finished':
      return pastel(mix(restGrey(pal), pal.accent, 0.55), dark);
    case 'asleep':
      return ensureContrast(mix(restGrey(pal), pal.blue, 0.1), pal.bg, dark ? 2.2 : 1.3);
    default: {
      // Awake idle: the same soft grey, a touch lighter and warmer than asleep.
      const awake = dark ? mix(restGrey(pal), pal.fg, 0.12) : mix(restGrey(pal), pal.bg, 0.12);
      return ensureContrast(mix(awake, pal.yellow, 0.05), pal.bg, dark ? 2.6 : 1.35);
    }
  }
}
