// createPen under a minimal fake DOM: a recording 2D context, a hand-cranked
// requestAnimationFrame and a controllable prefers-reduced-motion query.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function fakeDom({ reduce = false } = {}) {
  const listeners = { reduce: new Set() };
  const mq = (query) => {
    const isReduce = query.includes('reduced-motion');
    return {
      get matches() { return isReduce ? env.reduce : false; },
      addEventListener: (_t, fn) => { if (isReduce) listeners.reduce.add(fn); },
      removeEventListener: (_t, fn) => listeners.reduce.delete(fn),
    };
  };
  let log = [];
  const record = (name) => (...args) => { log.push(name + '(' + args.map((a) => (typeof a === 'number' ? a.toFixed(2) : '')).join(',') + ')'); };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(target, k) {
      if (k in target) return target[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => gradient;
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'getImageData') return () => ({ data: [0, 0, 0, 255] });
      return record(String(k));
    },
    set(target, k, v) { target[k] = v; return true; },
  });
  const node = (tag) => ({
    tagName: tag, style: {}, nodeType: 1, parentElement: null, children: [],
    setAttribute() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    remove() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
    getContext: () => ctx,
  });
  let rafQueue = [];
  const env = {
    reduce,
    get log() { return log; },
    clearLog() { log = []; },
    pendingFrames: () => rafQueue.length,
    /** Run frames covering `seconds` at 60fps. */
    step(seconds) {
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        const q = rafQueue; rafQueue = [];
        env.now += 1000 / 60;
        q.forEach((fn) => fn(env.now));
      }
    },
    setReduce(v) { env.reduce = v; listeners.reduce.forEach((fn) => fn({ matches: v })); },
    now: 1000,
  };
  Object.assign(globalThis, {
    document: { createElement: node, hidden: false, addEventListener() {}, removeEventListener() {} },
    window: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
    matchMedia: mq,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame: () => { rafQueue = []; },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: undefined,
    CustomEvent: class {},
  });
  return { env, el: node('div') };
}

const STATE = { critters: [{ id: 'hopper', name: 'Hopper', taskId: 't', taskName: 'T', agent: 'claude', status: 'working' }] };

/** Draw calls of the next frame (one 1/60s step). */
function frame(env) {
  env.clearLog();
  env.step(1 / 60);
  return env.log.join(';');
}

// Load after the fake DOM exists (pen.js touches nothing at import, but be safe).
const { createPen } = await import('../pen.js');

test('a working critter is static under reduced motion and animates without it', () => {
  const { env, el } = fakeDom({ reduce: true });
  const pen = createPen(el);
  pen.setState(STATE);
  env.step(0.5); // past the fade-in, before the first blink (≥ 1s)
  assert.ok(frame(env) === frame(env), 'reduced: consecutive frames identical');
  pen.destroy();

  const live = fakeDom({ reduce: false });
  const pen2 = createPen(live.el);
  pen2.setState(STATE);
  live.env.step(0.7);
  assert.ok(frame(live.env) !== frame(live.env), 'motion: the critter hops');
  pen2.destroy();
});

test('turning reduced motion off at the OS resumes animation, even when the host passed a snapshot', () => {
  // The extension mounts with reducedMotion: matchMedia(...).matches, a plain boolean.
  const { env, el } = fakeDom({ reduce: true });
  const pen = createPen(el, { reducedMotion: true });
  pen.setState(STATE);
  env.step(0.5);
  assert.ok(frame(env) === frame(env), 'starts static');

  env.setReduce(false);
  env.step(0.2);
  assert.ok(env.pendingFrames() > 0, 'the loop is still scheduling frames');
  assert.ok(frame(env) !== frame(env), 'animates again after the OS change');

  env.setReduce(true);
  env.step(0.2);
  assert.ok(frame(env) === frame(env), 'and stops again when reduce comes back');
  pen.destroy();
});

test('setOptions forces a mode until the next OS change', () => {
  const { env, el } = fakeDom({ reduce: false });
  const pen = createPen(el);
  pen.setState(STATE);
  env.step(0.6);
  pen.setOptions({ reducedMotion: true });
  env.step(0.1);
  assert.ok(frame(env) === frame(env), 'forced static');
  env.setReduce(false); // a fresh OS signal wins
  env.step(0.1);
  assert.ok(frame(env) !== frame(env), 'OS change overrides the forced value');
  pen.destroy();
});

test('reduced motion: no personality behaviours or ambient particles, even over minutes', () => {
  // Asleep critters keep their eyes shut, so blinks can't change a frame; any
  // yawn, chat, firefly or petal would.
  const { env, el } = fakeDom({ reduce: true });
  const pen = createPen(el);
  const nap = (id) => ({ id, name: id, taskId: 't', taskName: 'T', agent: 'claude', status: 'asleep' });
  pen.setState({ critters: [nap('a'), nap('b'), nap('c')] });
  env.step(1);
  const first = frame(env);
  for (let i = 0; i < 120; i++) {
    env.step(1);
    assert.equal(frame(env), first, `frame changed at ~${i + 1}s`);
  }
  pen.destroy();
});
