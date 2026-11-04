import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor, mix, contrast, ensureContrast, resolvePalette, isDark, toCss, TOKENS,
  rgbToHsl, hslToRgb, hueDistance, pastel, inkFor, statusColor, luminance,
} from '../color.js';

test('parseColor handles hex and rgb forms', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor(' #102030 '), { r: 16, g: 32, b: 48, a: 1 });
  assert.equal(parseColor('#10203080').a.toFixed(2), '0.50');
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColor('rgba(1,2,3,0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(parseColor('rgb(10 20 30 / 50%)'), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.equal(parseColor('oklch(70% 0.1 200)'), null);
  assert.equal(parseColor('#12'), null);
  assert.equal(parseColor(undefined), null);
});

test('mix, toCss and contrast behave', () => {
  const m = mix(parseColor('#000'), parseColor('#fff'), 0.5);
  assert.equal(Math.round(m.r), 128);
  assert.equal(toCss({ r: 1.4, g: 2, b: 3, a: 1 }, 0.5), 'rgba(1,2,3,0.5)');
  assert.ok(Math.abs(contrast(parseColor('#000'), parseColor('#fff')) - 21) < 0.01);
});

test('ensureContrast pushes grey away from a similar background', () => {
  const bg = parseColor('#14171c');
  const grey = parseColor('#1c2026');
  const out = ensureContrast(grey, bg, 2);
  assert.ok(contrast(out, bg) >= 2);
  assert.ok(out.r > grey.r, 'lightened on dark bg');
  const light = ensureContrast(parseColor('#eeeeee'), parseColor('#f6f6f6'), 1.5);
  assert.ok(light.r < 0xee, 'darkened on light bg');
});

test('resolvePalette falls back per token and uses the resolver', () => {
  const pal = resolvePalette({ green: '#00ff00', blue: 'weird()', bg: '' }, 'dark', (css) => (css === 'weird()' ? { r: 1, g: 2, b: 3, a: 1 } : null));
  assert.deepEqual(pal.green, { r: 0, g: 255, b: 0, a: 1 });
  assert.deepEqual(pal.blue, { r: 1, g: 2, b: 3, a: 1 });
  assert.ok(isDark(pal.bg), 'dark fallback bg');
  for (const k of TOKENS) assert.ok(pal[k], k);
  assert.ok(!isDark(resolvePalette({}, 'light').bg));
});

test('rgbToHsl and hslToRgb round-trip', () => {
  for (const hex of ['#56d364', '#6ca7ff', '#f5c542', '#ff6b6b', '#3a414b', '#ffffff', '#000000', '#8e5bd8']) {
    const c = parseColor(hex);
    const { h, s, l } = rgbToHsl(c);
    const back = hslToRgb(h, s, l);
    for (const k of ['r', 'g', 'b']) assert.ok(Math.abs(back[k] - c[k]) < 0.5, `${hex}.${k}`);
  }
  assert.deepEqual(rgbToHsl(parseColor('#808080')), { h: 0, s: 0, l: 128 / 255, a: 1 });
  assert.equal(Math.round(rgbToHsl(parseColor('#00ff00')).h), 120);
  assert.equal(hueDistance(350, 10), 20);
  assert.equal(hueDistance(90, 270), 180);
});

test('pastel keeps the hue, softens saturation and stays in a lightness band', () => {
  for (const dark of [true, false]) {
    for (const hex of ['#56d364', '#2fa84f', '#6ca7ff', '#3b7ddd', '#f5c542', '#e9a514', '#ff6b6b', '#e5484d']) {
      const c = parseColor(hex), p = pastel(c, dark);
      const a = rgbToHsl(c), b = rgbToHsl(p);
      assert.ok(hueDistance(a.h, b.h) < 1, `${hex} hue kept`);
      assert.ok(b.s <= Math.max(a.s, 0.35) + 1e-9, `${hex} no more saturated`);
      const [lo, hi] = dark ? [0.64, 0.8] : [0.58, 0.72];
      assert.ok(b.l >= lo - 1e-9 && b.l <= hi + 1e-9, `${hex} lightness ${b.l}`);
    }
  }
  const grey = rgbToHsl(pastel(parseColor('#3a414b'), true));
  assert.ok(grey.s < 0.12, 'greys stay grey');
});

test('inkFor is a darker cousin of the body colour', () => {
  for (const hex of ['#77cd81', '#7ba6e6', '#e2c065', '#e67a7a', '#808c9d']) {
    const c = parseColor(hex), ink = inkFor(c);
    assert.ok(luminance(ink) < luminance(c) * 0.6, hex);
    assert.ok(hueDistance(rgbToHsl(ink).h, rgbToHsl(c).h) <= 12.5, `${hex} hue stays close`);
  }
});

test('status colours stay distinct and come from the theme tokens', () => {
  for (const mode of ['dark', 'light']) {
    const pal = resolvePalette({}, mode);
    pal.dark = isDark(pal.bg);
    const hue = (s) => rgbToHsl(statusColor(s, pal)).h;
    const tokenHue = (k) => rgbToHsl(pal[k]).h;
    for (const [status, token] of [['working', 'green'], ['thinking', 'blue'], ['needs-you', 'yellow'], ['error', 'red']]) {
      assert.ok(hueDistance(hue(status), tokenHue(token)) < 1, `${mode} ${status} keeps --${token}'s hue`);
    }
    const loud = ['working', 'thinking', 'needs-you', 'error', 'finished'];
    for (const a of loud) for (const b of loud) if (a < b) assert.ok(hueDistance(hue(a), hue(b)) > 25, `${mode} ${a} vs ${b}`);
    for (const s of ['idle', 'asleep']) assert.ok(rgbToHsl(statusColor(s, pal)).s < 0.35, `${mode} ${s} reads grey`);
    for (const s of ['working', 'thinking', 'error', 'idle', 'asleep']) assert.ok(contrast(statusColor(s, pal), pal.bg) >= 1.3, `${mode} ${s} visible on the floor`);
    // A theme change flows straight through.
    const custom = { ...pal, green: parseColor('#00aaff') };
    assert.ok(hueDistance(rgbToHsl(statusColor('working', custom)).h, 200) < 1);
  }
});
