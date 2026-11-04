import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naturePalette, leashStyle, leashControl } from '../scene.js';
import { parseColor, contrast, resolvePalette } from '../color.js';

const P = (raw, mode) => ({ ...resolvePalette(raw, mode), dark: mode === 'dark' });
// The engine's fallbacks plus the demo page's themes.
const PALETTES = {
  'fallback dark': P({}, 'dark'),
  'fallback light': P({}, 'light'),
  'demo dark': P({ green: '#56d364', bg: '#12151b', fg: '#e6edf3', 'surface-2': '#3a414b' }, 'dark'),
  'demo light': P({ green: '#2fa84f', bg: '#f4f1ea', fg: '#23262d', 'surface-2': '#cfd3da' }, 'light'),
};
function hue({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a, b) => { const d = Math.abs(hue(a) - hue(b)) % 360; return Math.min(d, 360 - d); };

for (const [name, pal] of Object.entries(PALETTES)) {
  test(`${name}: grass is clearly not status green`, () => {
    const n = naturePalette(pal);
    for (const g of [n.grass, n.grassDark]) {
      assert.ok(hueGap(g, pal.green) >= 30, `hue gap ${hueGap(g, pal.green).toFixed(0)}°`);
      assert.ok(contrast(g, pal.green) >= 1.4, `contrast ${contrast(g, pal.green).toFixed(2)}`);
    }
  });

  test(`${name}: leashes read on grass and on sky`, () => {
    const n = naturePalette(pal), st = leashStyle(pal);
    assert.ok(st.width >= 2 && st.width <= 2.6, 'about 2-2.5px');
    assert.ok(st.haloWidth > st.width);
    assert.ok(contrast(st.rope, n.grass) >= 2.5, `rope on grass ${contrast(st.rope, n.grass).toFixed(2)}`);
    assert.ok(contrast(st.rope, pal.bg) >= 3, `rope on sky ${contrast(st.rope, pal.bg).toFixed(2)}`);
    // The halo sets the rope off from whatever it crosses.
    assert.ok(contrast(st.rope, st.halo) >= 4, `rope on halo ${contrast(st.rope, st.halo).toFixed(2)}`);
  });
}

test('leash sags below both ends, more for longer ropes', () => {
  const a = { x: 0, y: 100 }, b = { x: 200, y: 80 };
  const c = leashControl(a, b);
  assert.ok(c.y > 100);
  assert.ok(leashControl({ x: 0, y: 100 }, { x: 600, y: 100 }).y - 100 > c.y - 100);
  assert.equal(c.x, 100);
  assert.ok(parseColor('#000') && true);
});
