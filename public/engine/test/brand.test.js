import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GIT_MARK } from '../brand/git.js';
import { PLANK_MARKS, markVariantFor, transformSteps, drawMark } from '../brand/index.js';
import { naturePalette } from '../scene.js';
import { resolvePalette, isDark } from '../color.js';

const palFor = (mode) => { const p = resolvePalette({}, mode); return { ...p, dark: isDark(p.bg) }; };

test('the Git mark is the official artwork, byte for byte', () => {
  // SHA-256 of the path data in https://git-scm.com/images/logos/downloads/Git-Icon-{Black,White}.svg
  assert.equal(createHash('sha256').update(GIT_MARK.path).digest('hex'), 'd85a74336fd0f7115f0a5aba89e5f4834b61a2b6c19ae39a5b77593123212261');
  assert.equal(GIT_MARK.viewBox, '0 0 78 78');
  assert.equal(GIT_MARK.transform, 'translate(10 10) rotate(-45 29 29)');
  assert.deepEqual(Object.keys(GIT_MARK.variants).sort(), ['black', 'white']);
  assert.equal(GIT_MARK.variants.black.fill, '#100f0d');
  assert.equal(GIT_MARK.variants.white.fill, '#fff');
  assert.ok(Object.isFrozen(GIT_MARK) && Object.isFrozen(GIT_MARK.variants));
});

test('only marks whose guidelines allow this use are on planks', () => {
  assert.deepEqual(Object.keys(PLANK_MARKS), ['git']);
  for (const kind of ['pr', 'jira', 'terminal', 'web', 'files', 'human']) assert.equal(PLANK_MARKS[kind], undefined, kind);
});

test('the variant is picked by contrast with the plank, from official variants only', () => {
  for (const mode of ['dark', 'light']) {
    const wood = naturePalette(palFor(mode)).wood;
    assert.ok(['black', 'white'].includes(markVariantFor(GIT_MARK, wood)));
  }
  assert.equal(markVariantFor(GIT_MARK, { r: 240, g: 230, b: 210, a: 1 }), 'black');
  assert.equal(markVariantFor(GIT_MARK, { r: 30, g: 25, b: 20, a: 1 }), 'white');
});

test('drawMark applies only a fit-to-size scale plus the SVG\'s own transform', () => {
  assert.deepEqual(transformSteps(GIT_MARK.transform), [
    { op: 'translate', x: 10, y: 10 }, { op: 'rotate', deg: -45, cx: 29, cy: 29 },
  ]);
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => calls.push([k, ...a.filter((v) => typeof v === 'number').map((v) => +v.toFixed(4))])), set: (t, k, v) => { t[k] = v; return true; } });
  globalThis.Path2D = class { constructor(d) { this.d = d; } };
  try {
    assert.equal(drawMark(ctx, GIT_MARK, 100, 50, 78, 'black'), true);
    assert.equal(ctx.fillStyle, '#100f0d');
    const ops = calls.map((c) => c[0]);
    assert.deepEqual(ops, ['save', 'translate', 'scale', 'translate', 'translate', 'translate', 'rotate', 'translate', 'fill', 'restore']);
    assert.deepEqual(calls[2], ['scale', 1, 1], 'size 78 = the viewBox: no scaling');
    assert.ok(Math.abs(calls[6][1] + Math.PI / 4) < 1e-4, 'rotation is the SVG\'s -45°');
    assert.equal(drawMark(ctx, GIT_MARK, 0, 0, 10, 'orange'), false, 'no invented variants');
  } finally { delete globalThis.Path2D; }
});

test('NOTICE.md credits the Git logo and disclaims affiliation', () => {
  const notice = readFileSync(new URL('../brand/NOTICE.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(notice, /Git Logo by Jason Long is licensed under the Creative Commons Attribution 3\.0 Unported License/);
  assert.match(notice, /creativecommons\.org\/licenses\/by\/3\.0/);
  assert.match(notice, /Software Freedom Conservancy/);
  assert.match(notice, /not affiliated with/i);
});
