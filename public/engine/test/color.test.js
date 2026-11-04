import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, mix, contrast, ensureContrast, resolvePalette, isDark, toCss, TOKENS } from '../color.js';

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
