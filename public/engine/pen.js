// Critter Pen engine: createPen(el, opts) → { setState, emit, resize, destroy }.
// Canvas 2D, one requestAnimationFrame loop, no dependencies, no wrangler knowledge.

import { LANDMARK_KINDS, STATUSES, isPenEvent } from './contract.js';
import {
  critterTraits,
  rng,
  clamp,
  lerp,
  ease,
  springStep,
  truncateToWidth,
  truncateMiddle,
  quad,
  quadAngle,
  arcControl,
  TAU,
} from './util.js';
import { readTheme, toCss, mix, lighten, darken, statusColor } from './color.js';
import { computeLayout, islandPoint, pickAt, LANDMARK_LABELS } from './layout.js';
import { createWander, stepWander, wanderPace, separate, islandAxes, PERSONAL_SPACE, DEPTH_WEIGHT } from './wander.js';
import { drawIsland, drawSignpost, drawBuilding, drawLeash } from './scene.js';
import { drawKeeper, keeperMouth, keeperHitbox, catchProgress, recentCatches, KEEPER_NAMES } from './buildings.js';
import {
  drawCarrier,
  drawServiceBuilding,
  drawCaptionPlank,
  isletFootprint,
  isletBob,
  bellQueueSlots,
  buildingFootprint,
  PHONE_HOLDER_SLOT,
  phoneSocket,
  receiverSpot,
  drawPhoneReceiver,
} from './buildings.js';
import { placeLabels, stripTaskPrefix, shortLabel } from './labels.js';
import { diffCritters } from './diff.js';
import {
  ACCESSORIES,
  agentTint,
  kindColor,
  drawCritter,
  drawShadow,
  drawBubble,
  drawThinkingDots,
  drawDizzyStars,
  drawStar,
  drawProjectile,
  haloText,
  roundRect,
  ellipse,
  drawChatBubble,
} from './art.js';
// ── personality hooks ── (behaviour.js / ambient.js / art.js are the character artist's)
import { createMind, applyBehaviour } from './behaviour.js';
import { drawAmbient, drawSky } from './ambient.js';

/** @typedef {import('./contract.js').PenState} PenState */
/** @typedef {import('./contract.js').PenEvent} PenEvent */
/** @typedef {import('./contract.js').PenOptions} PenOptions */

const STATUS_BLEND = 0.45; // seconds to cross-fade pose + colour on status change
const FONT_NAME = '700 12px system-ui, -apple-system, Segoe UI, sans-serif'; // labels.js LABEL_H matches
const FONT_NAME_PARENT = '800 12px system-ui, -apple-system, Segoe UI, sans-serif'; // parents read a touch bolder
const FONT_TASK = '700 10px system-ui, -apple-system, Segoe UI, sans-serif';
const FONT_FLOAT = '700 11px system-ui, -apple-system, Segoe UI, sans-serif';

/** Body colour for a status in the current palette (pastel-tuned; lives in color.js). */
export { statusColor };

/**
 * A keeper's catch state from the landing times of projectiles aimed at it
 * (past and still in flight): the newest catch in progress, and how many
 * landed in the last moment (enough of them and it looks full).
 */
export function catchStateAt(lands, now) {
  let progress = null,
    latest = -Infinity;
  for (const at of lands) {
    const p = catchProgress(now, at);
    if (p != null && at > latest) {
      latest = at;
      progress = p;
    }
  }
  return { progress, recent: recentCatches(lands, now) };
}

/**
 * Mount a pen into `el` (which must have a size; the canvas fills it).
 * @param {HTMLElement} el
 * @param {PenOptions & { onCritterClick?: (id: string) => void }} [opts]
 */
export function createPen(el, opts = {}) {
  // The canvas sits in its own box and we measure that, not `el`: hosts such
  // as the wrangler's view slot are `display: contents` and have no size.
  const wrap = document.createElement('div');
  wrap.className = 'critter-pen-wrap';
  wrap.style.cssText = 'position:relative;width:100%;height:100%;min-height:inherit;overflow:hidden;';
  const canvas = document.createElement('canvas');
  canvas.className = 'critter-pen-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:manipulation;';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Critter pen');
  wrap.appendChild(canvas);
  el.appendChild(wrap);
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

  let W = 0,
    H = 0,
    dpr = 1;
  let themeMode = opts.theme || 'auto';
  let pal = readTheme(el, themeMode);
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = opts.reducedMotion ?? mqReduce.matches;

  /** @type {Map<string, any>} */ const sprites = new Map();
  /** @type {Map<string, any>} */ let prev = new Map();
  /** @type {ReturnType<typeof computeLayout>|null} */ let layout = null;
  const clusterViz = new Map();
  // ── islands / wander ──
  const islandViz = new Map(); // taskId → eased island geometry + bob
  const bellQueue = []; // ids of critters waiting at the bell, in arrival order
  const keeperLands = new Map(); // kind → landing times (past and in flight) of projectiles at its keeper
  let hoveredKeeper = null;
  const projectiles = [],
    particles = [],
    floaters = [];
  const lmState = new Map(LANDMARK_KINDS.map((k) => [k, { pulseAge: 9, ringAge: 9, glowAge: 9, wiggleAge: 9 }]));
  const pendingBaby = new Map(); // parentId → { x, y, at }
  let time = 0,
    lastTs = 0,
    raf = 0,
    destroyed = false,
    firstState = true,
    needsLayout = true;
  let hovered = null,
    labelWidth = 70;
  let pointer = null,
    frameDt = 1 / 60; // ── personality hooks ──

  // ── sprites ────────────────────────────────────────────────────────────────

  function makeSprite(c, delay = 0) {
    const tr = critterTraits(c.id, ACCESSORIES.length);
    const seed = tr.seed;
    // Runtime randomness (blinks, smoke) gets its own stream, apart from the looks.
    const rand = rng(seed ^ 0x9e3779b9);
    return {
      id: c.id,
      data: c,
      seed,
      rand,
      hue: tr.hue,
      hopRhythm: tr.hop,
      accessory: ACCESSORIES[tr.accessory],
      ...inks(c.agent, tr.hue),
      phase: tr.phase,
      sizeJitter: tr.size,
      x: { x: 0, v: 0 },
      y: { x: 0, v: 0 },
      r: { x: 0, v: 0 },
      homeX: 0,
      homeY: 0,
      homeR: 16,
      placed: false,
      status: c.status,
      prevStatus: c.status,
      statusAge: 9,
      colorFrom: null,
      life: 'enter',
      age: -delay,
      alpha: 0,
      scale: 0,
      enterFrom: null,
      leaveAge: 0,
      leaveDir: 1,
      blinkAt: 1 + rand() * 4,
      blinkAge: 9,
      lookAt: null,
      lookUntil: 0,
      throwAge: 9,
      celebrateAge: 9,
      shockAge: 9,
      flashAge: 9,
      flashColor: null,
      visit: null,
      hopP: 0,
      smokeT: rand() * 2,
      zT: rand() * 2,
      label: null,
      labelFor: '',
      cx: 0,
      cy: 0,
      cr: 0,
      flip: false,
      spin: 0,
      // ── islands / wander ──
      wander: null,
      home: null,
      place: null,
      hop: null,
      // ── personality hooks ──
      mind: createMind(seed),
      gaze: { x: 0, y: 0 },
      attn: null,
    };
  }

  function inks(agent, hue) {
    const tint = agentTint(agent, hue);
    return { tint, eyeInk: mix({ r: 29, g: 32, b: 38, a: 1 }, darken(tint, 0.5), 0.35) };
  }

  function placeAt(s, x, y) {
    s.x.x = x;
    s.y.x = y;
    s.x.v = s.y.v = 0;
    s.placed = true;
  }

  /** @param {PenState} state */
  function setState(state) {
    if (destroyed || !state || !Array.isArray(state.critters)) return;
    const d = diffCritters(prev, state.critters);
    if (!d.added.length && !d.removed.length && !d.statusChanged.length && !d.updated.length) return;
    let membership = d.added.length > 0 || d.removed.length > 0 || d.updated.length > 0;

    d.added.forEach((c, i) => {
      const existing = sprites.get(c.id);
      if (existing && existing.life === 'leave') {
        // Came back before it finished walking off: turn around.
        existing.life = 'live';
        existing.data = c;
        existing.alpha = 1;
        existing.status = c.status;
        existing.statusAge = 9;
        return;
      }
      const s = makeSprite(c, firstState ? Math.min(i * 0.07, 1.5) : 0);
      if (!firstState && c.parentId && sprites.has(c.parentId)) {
        const baby = pendingBaby.get(c.parentId);
        const parent = sprites.get(c.parentId);
        s.enterFrom =
          baby && time - baby.at < 4
            ? { x: baby.x, y: baby.y, landed: true }
            : { x: parent.cx, y: parent.cy + parent.cr };
        pendingBaby.delete(c.parentId);
        // ── personality hooks ── family and islandmates wave hello once it lands.
        let n = 0;
        for (const o of sprites.values()) {
          if (
            n >= 5 ||
            o.life !== 'live' ||
            (o.data.parentId !== c.parentId && o.id !== c.parentId && o.data.taskId !== c.taskId)
          )
            continue;
          o.mind.trigger('wave', time, { delay: 0.7 + n++ * 0.18, targetId: c.id });
        }
      }
      if (c.status === 'archived') s.life = 'gone'; // never seen alive; don't draw
      sprites.set(c.id, s);
    });
    for (const c of d.updated) {
      const s = sprites.get(c.id);
      if (s) Object.assign(s, { data: c }, inks(c.agent, s.hue));
    }
    for (const { id, from, to } of d.statusChanged) {
      const s = sprites.get(id);
      if (!s) continue;
      s.data = d.next.get(id);
      setStatus(s, to);
      if (from === 'archived' || to === 'archived') membership = true;
    }
    for (const id of d.removed) {
      const s = sprites.get(id);
      if (s && s.life !== 'leave') startLeaving(s, true);
    }
    prev = d.next;
    firstState = false;
    if (membership) needsLayout = true;
  }

  function setStatus(s, to) {
    s.colorFrom = currentColor(s);
    s.prevStatus = s.status;
    s.status = to;
    s.statusAge = 0;
    if (to === 'archived') startLeaving(s);
    else if (s.life === 'leave') {
      s.life = 'live';
      s.alpha = 1;
    } else if (s.life === 'gone') {
      s.life = 'enter';
      s.age = 0;
    }
  }

  function startLeaving(s, removed = false) {
    if (s.life === 'gone') {
      if (removed) sprites.delete(s.id);
      return;
    }
    s.life = 'leave';
    s.leaveAge = 0;
    s.visit = null;
    s.leaveDir = s.x.x < W / 2 ? -1 : 1;
  }

  function relayout() {
    const live = [];
    for (const s of sprites.values()) if (s.life === 'enter' || s.life === 'live') live.push(s.data);
    // Pass the previous layout: unless the pen was resized, everything placed stays pinned.
    layout = computeLayout({ width: W, height: H, critters: live, prev: layout, footprint: isletFootprint });
    labelWidth = layout.labelWidth;
    for (const [id, slot] of layout.slots) {
      const s = sprites.get(id);
      if (!s) continue;
      // Size by role: parents big, children small. s.r springs to it, so a
      // child arriving or leaving eases the parent's size instead of popping.
      s.role = slot.role || 'solo';
      s.roleScale = slot.scale ?? 1;
      s.homeR = slot.r * s.sizeJitter * s.roleScale;
      // ── islands / wander ── keep wandering where it was unless the task changed.
      const spot = layout.spots?.get(id);
      if (spot && (!s.wander || s.home?.taskId !== spot.taskId)) {
        s.wander = createWander(spot.u, spot.v, s.rand);
        s.home = { taskId: spot.taskId };
      } else if (spot && reduced) {
        s.wander.u = spot.u;
        s.wander.v = spot.v;
      }
      if (!spot) {
        s.wander = null;
        s.home = null;
      }
      s.homeX = slot.x;
      s.homeY = slot.y + slot.r; // ground point
      if (!s.placed) {
        const from = s.enterFrom;
        placeAt(s, from ? from.x : s.homeX, from ? from.y : s.homeY);
        s.r.x = s.homeR;
      }
      if (reduced) placeAt(s, s.homeX, s.homeY);
    }
    needsLayout = false;
  }

  let statusCache = null;
  function colorOf(status) {
    if (!statusCache) statusCache = Object.fromEntries(STATUSES.map((k) => [k, statusColor(k, pal)]));
    statusCache[status] ||= statusColor(status, pal);
    return statusCache[status];
  }
  function setPalette(p) {
    pal = p;
    statusCache = null;
  }

  function currentColor(s) {
    const to = colorOf(s.status);
    if (!s.colorFrom || s.statusAge >= STATUS_BLEND) return to;
    return mix(s.colorFrom, to, ease.inOutSine(s.statusAge / STATUS_BLEND));
  }

  // ── events ─────────────────────────────────────────────────────────────────

  /** @param {PenEvent} ev */
  function emit(ev) {
    if (destroyed || !isPenEvent(ev)) return;
    const s = sprites.get(ev.critterId);
    const alive = s?.placed && s.age >= 0 && (s.life === 'live' || s.life === 'enter');
    const from = alive ? { x: s.cx, y: s.cy - s.cr * 0.6 } : null;

    if (LANDMARK_KINDS.includes(ev.kind)) {
      const lm = layout?.landmarks.find((l) => l.kind === ev.kind);
      if (!lm) return;
      if (ev.kind === 'human' && alive && !reduced) {
        s.visit = { lm, age: 0, stage: 'go', label: ev.label };
        return;
      }
      const mouth = keeperTarget(ev.kind);
      if (from && reduced && mouth) {
        // Reduced motion: no flight; the projectile fades into the keeper's mouth.
        projectiles.push({
          kind: ev.kind,
          fadeAt: mouth,
          p0: mouth,
          p1: mouth,
          p2: mouth,
          age: 0,
          delay: 0,
          dur: 0.45,
          last: true,
          label: ev.label,
          lm,
        });
        noteLanding(ev.kind, time + 0.45);
        flash(s, kindColor(ev.kind, pal));
        return;
      }
      if (!from || reduced) {
        hitLandmark(lm, ev.label);
        if (alive) flash(s, kindColor(ev.kind, pal));
        return;
      }
      fire(s, from, lm, ev.kind, ev.label);
      return;
    }
    if (!alive) return;
    if (ev.kind === 'done') {
      s.celebrateAge = 0;
      s.mind.trigger('wiggle', time, { delay: 1.5 }); // ── personality hooks ──
      if (reduced) flash(s, pal.accent, 1.6);
      else burst(s.cx, s.cy - s.cr, 'confetti', 28);
      if (ev.label) floatText(ev.label, s.cx, s.cy - s.cr * 2.4, pal.green, -1);
    } else if (ev.kind === 'error') {
      s.shockAge = 0;
      if (reduced) flash(s, pal.red, 1.2);
      else for (let i = 0; i < 5; i++) puff(s.cx + (s.rand() - 0.5) * s.cr, s.cy - s.cr * 1.6, 'smoke', i * 0.04);
      if (ev.label) floatText(ev.label, s.cx, s.cy - s.cr * 2.4, pal.red, -1);
    } else if (ev.kind === 'spawn') {
      s.throwAge = 0;
      const recentKid = [...sprites.values()].some((k) => k.data.parentId === s.id && k.age < 1.5 && k.age >= 0);
      if (reduced) {
        flash(s, pal.accent);
      } else {
        burst(s.cx, s.cy - s.cr, 'sparkle', 10);
        if (!recentKid) {
          const dir = s.rand() < 0.5 ? -1 : 1;
          const to = { x: clamp(s.cx + dir * s.cr * 3, 10, W - 10), y: s.cy + s.cr };
          projectiles.push({
            kind: 'spawn',
            p0: from,
            p1: { x: (from.x + to.x) / 2, y: from.y - s.cr * 2.5 },
            p2: to,
            age: 0,
            delay: 0,
            dur: 0.6,
            color: currentColor(s),
            r: s.cr * 0.45,
            onHit: () => {
              burst(to.x, to.y - 6, 'sparkle', 8);
              pendingBaby.set(s.id, { x: to.x, y: to.y, at: time });
            },
          });
        }
      }
      if (ev.label) floatText(ev.label, s.cx, s.cy - s.cr * 2.4, pal.accent, -1);
    }
  }

  function flash(s, color, dur = 1) {
    s.flashAge = 0;
    s.flashColor = color;
    s.flashDur = dur;
  }

  function fire(s, from, lm, kind, label) {
    s.throwAge = 0;
    s.lookAt = { x: lm.x, y: lm.y };
    s.lookUntil = time + 1.2;
    // Aim for the service keeper's mouth (it catches and eats them), else the building.
    const to = keeperTarget(kind) || { x: lm.x, y: lm.y };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const base = clamp(dist / 520, 0.55, 1.15);
    const count = kind === 'git' ? 3 : kind === 'files' ? 4 : 1;
    for (let i = 0; i < count; i++) {
      const jitter = count > 1 ? (s.rand() - 0.5) * 50 : 0;
      const ctl = arcControl(from, to, 6);
      ctl.x += jitter;
      if (kind === 'web') ctl.y = Math.max(6, ctl.y - 40);
      const p = {
        kind,
        p0: { ...from },
        p1: ctl,
        p2: to,
        age: 0,
        delay: 0.08 + i * (kind === 'git' ? 0.11 : 0.06),
        dur: kind === 'web' ? base * 1.7 : base + i * 0.03,
        last: i === count - 1,
        label,
        lm,
        sway: kind === 'web' ? 10 : 0,
      };
      projectiles.push(p);
      noteLanding(kind, time + p.delay + p.dur); // the keeper starts its catch just before
    }
  }

  /** Where a service keeper's mouth is now (riding its islet), or null if it has none. */
  function keeperTarget(kind) {
    const isl = layout?.islets?.find((i) => i.kind === kind);
    const m = isl && keeperMouth(kind, isl.scale);
    if (!m) return null;
    const base = isletBase(isl);
    return { x: base.x + m.dx, y: base.y + m.dy };
  }

  function noteLanding(kind, at) {
    if (!keeperLands.has(kind)) keeperLands.set(kind, []);
    const list = keeperLands.get(kind);
    list.push(at);
    while (list.length && list[0] < time - 3) list.shift(); // only the last few seconds matter
  }

  /** The service keeper (not the phone box's) under (x, y), for its hover tooltip. */
  function pickKeeper(x, y) {
    for (const isl of layout?.islets || []) {
      const hb = keeperHitbox(isl.kind, isl.scale);
      if (!hb) continue;
      const base = isletBase(isl);
      if (Math.hypot(x - (base.x + hb.dx), y - (base.y + hb.dy)) <= hb.r) return isl;
    }
    return null;
  }

  function hitLandmark(lm, label) {
    const st = lmState.get(lm.kind);
    st.pulseAge = 0;
    st.ringAge = 0;
    st.glowAge = 0;
    if (lm.kind === 'human') st.wiggleAge = 0;
    if (!reduced) burst(lm.x, lm.y, 'spark', 7, kindColor(lm.kind, pal));
    if (label) {
      const isl = lm.islet && layout?.islets?.find((i) => i.kind === lm.kind);
      if (isl) {
        // Rise from above the building, clear of its keeper; if that's off the top
        // of the pen, drop from under its caption plank instead.
        const base = isletBase(isl),
          top = base.y - buildingFootprint(isl.kind, isl.scale).top - 12;
        if (top > 30) floatText(label, base.x, top, kindColor(lm.kind, pal), -1);
        else floatText(label, isl.x, base.captionY + 30, kindColor(lm.kind, pal), 1);
      } else {
        const dir = lm.side === 'top' ? 1 : -1;
        floatText(label, lm.x, lm.y + dir * (lm.r + 16), kindColor(lm.kind, pal), dir);
      }
    }
  }

  function floatText(text, x, y, color, dir) {
    text = String(text).slice(0, 40);
    ctx.font = FONT_FLOAT;
    const w = ctx.measureText(text).width + 14;
    const dur = 1.9;
    // Labels whose pills would overlap this one.
    const clash = floaters.filter(
      (f) => Math.abs(f.x - x) < (f.w + w) / 2 + 4 && Math.abs(f.y0 - y) < 40 && f.age < f.dur - 0.4,
    );
    if (layout?.compact) {
      // No room to stack in the tray: queue behind whatever is showing.
      const wait = Math.max(0, ...clash.map((f) => f.dur - 0.4 - f.age));
      if (wait > 2.5) return;
      floaters.push({ text, w, x, y, y0: y, dir, color, age: -wait, dur });
    } else {
      // Stack behind labels still rising from the same spot.
      const busy = clash.filter((f) => f.age < 0.9).length;
      if (busy >= 3) return; // a burst of hits: the pulse says enough
      floaters.push({ text, w, x, y: y + dir * busy * 22, y0: y, dir, color, age: 0, dur });
    }
    if (floaters.length > 24) floaters.shift();
  }

  // ── particles ──────────────────────────────────────────────────────────────

  const rnd = Math.random;
  function addParticle(p) {
    if (particles.length > 400) particles.shift();
    particles.push({ age: 0, rot: 0, vr: 0, grav: 0, drag: 0.9, ...p });
  }
  function puff(x, y, type, delay = 0) {
    if (type === 'smoke') {
      addParticle({
        type,
        x,
        y,
        vx: (rnd() - 0.5) * 14,
        vy: -22 - rnd() * 12,
        life: 1.6,
        size: 4 + rnd() * 3,
        age: -delay,
      });
    } else if (type === 'dust') {
      for (const s of [-1, 1])
        addParticle({
          type,
          x: x + s * 4,
          y,
          vx: s * (18 + rnd() * 16),
          vy: -6 - rnd() * 6,
          life: 0.55,
          size: 2.5 + rnd() * 1.5,
          drag: 0.92,
        });
    }
  }
  function burst(x, y, type, n, color) {
    const cols = [pal.green, pal.blue, pal.yellow, pal.red, pal.accent];
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU,
        sp = type === 'confetti' ? 90 + rnd() * 140 : 40 + rnd() * 70;
      addParticle({
        type,
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (type === 'confetti' ? 120 : 20),
        grav: type === 'confetti' ? 320 : type === 'spark' ? 60 : 0,
        drag: type === 'confetti' ? 0.985 : 0.93,
        life: type === 'confetti' ? 1.6 + rnd() * 0.6 : 0.5 + rnd() * 0.35,
        size: type === 'confetti' ? 3 + rnd() * 2.5 : 2 + rnd() * 2.5,
        rot: rnd() * TAU,
        vr: (rnd() - 0.5) * 14,
        color: color || cols[i % cols.length],
      });
    }
  }

  // ── simulation ─────────────────────────────────────────────────────────────

  // ── islands / wander ──
  /** Ease island geometry toward the layout, bob it, keep the bell queue, space critters out. */
  function updateIslands(dt) {
    const seen = new Set();
    for (const isl of layout?.islands || []) {
      seen.add(isl.taskId);
      let v = islandViz.get(isl.taskId);
      if (!v) {
        v = { ...isl, a: reduced ? 1 : 0, bob: 0, phase: (isl.seed % 1000) / 160 };
        islandViz.set(isl.taskId, v);
      }
      const k = reduced ? 1 : 1 - Math.exp(-dt * 4);
      for (const f of ['cx', 'cy', 'rx', 'ry']) v[f] += (isl[f] - v[f]) * k;
      Object.assign(v, { taskName: isl.taskName, rocky: isl.rocky, seed: isl.seed, gone: false });
      v.a = Math.min(1, v.a + dt * 2);
      v.bob = reduced ? 0 : Math.sin(time * 0.8 + v.phase) * 3;
    }
    for (const [id, v] of islandViz) {
      if (seen.has(id)) continue;
      v.gone = true;
      v.a -= dt * 1.5;
      if (v.a <= 0 || reduced) islandViz.delete(id);
    }
    // Bell queue: needs-you critters, first come first served.
    for (const s of sprites.values()) {
      const wants = layout?.islets && s.status === 'needs-you' && (s.life === 'live' || s.life === 'enter');
      const i = bellQueue.indexOf(s.id);
      if (wants && i < 0) bellQueue.push(s.id);
      else if (!wants && i >= 0) bellQueue.splice(i, 1);
    }
    for (let i = bellQueue.length - 1; i >= 0; i--) if (!sprites.has(bellQueue[i])) bellQueue.splice(i, 1);
    if (reduced) return;
    // Personal space on each island.
    const byIsland = new Map();
    for (const s of sprites.values()) {
      if (!s.wander || s.life !== 'live' || s.place !== 'island' || s.hop) continue;
      if (!byIsland.has(s.home.taskId)) byIsland.set(s.home.taskId, []);
      s.wander.rad = s.r.x; // bigger critters keep more room
      s.wander.m = s.role === 'parent' ? 0.05 : 1; // and parents hold their ground
      byIsland.get(s.home.taskId).push(s.wander);
    }
    for (const [id, list] of byIsland) {
      const v = islandViz.get(id);
      if (v && list.length > 1) {
        const { ax, ay } = islandAxes(v, layout.radius);
        separate(list, layout.radius * PERSONAL_SPACE, ax, ay * DEPTH_WEIGHT, 0.6);
      }
    }
  }

  /** Where a critter's strolls centre: parents near the middle, children near their parent. */
  function wanderAround(s) {
    if (s.role === 'parent') return { u: 0, v: 0, rad: 0.3 };
    const p = s.role === 'child' && sprites.get(s.data.parentId);
    if (p?.wander && p.home?.taskId === s.home?.taskId && p.place === 'island')
      return { u: p.wander.u, v: p.wander.v, rad: 0.45 };
    return null;
  }

  /** Service buildings, their caption planks and island name planks: places name labels must not cover. */
  function labelObstacles() {
    if (!layout?.islets) return [];
    const out = [];
    ctx.font = '700 10px system-ui, -apple-system, Segoe UI, sans-serif';
    for (const i of layout.islets) {
      const bf = buildingFootprint(i.kind, i.scale),
        base = isletBase(i);
      out.push({ l: base.x - bf.w / 2, r: base.x + bf.w / 2, t: base.y - bf.top, b: base.y });
      const hb = keeperHitbox(i.kind, i.scale);
      if (hb)
        out.push({
          l: base.x + hb.dx - hb.r,
          r: base.x + hb.dx + hb.r,
          t: base.y + hb.dy - hb.r,
          b: base.y + hb.dy + hb.r,
        });
      const sc = clamp(i.scale, 0.8, 1.2),
        w = (ctx.measureText(LANDMARK_LABELS[i.kind]).width + 14) * sc;
      out.push({ l: i.x - w / 2, r: i.x + w / 2, t: base.captionY, b: base.captionY + 17 * sc });
    }
    const sc = clamp(layout.radius / 18, 0.8, 1.15);
    for (const v of islandViz.values()) {
      const w = Math.min(150, ctx.measureText(v.taskName || '').width + 14) * sc;
      const top = v.cy + v.bob + v.ry * 1.3 + 4;
      out.push({ l: v.cx - w / 2, r: v.cx + w / 2, t: top, b: top + 17 * sc });
    }
    return out;
  }

  /** Where an islet's building stands this frame (bob included), and where its plank hangs. */
  function isletBase(i) {
    const cy = i.y + isletBob(i.kind, time, i.scale, reduced);
    return {
      x: i.kind === 'human' ? i.x : i.x - i.fp.rx * 0.08,
      y: cy + i.fp.ry * 0.15,
      captionY: cy + i.fp.ry * 1.3 + 4,
    };
  }

  /** Spot n in the queue outside the "you" islet's building (riding its bob). */
  function youSpot(n) {
    const isl = layout.islets.find((i) => i.kind === 'human');
    const base = isletBase(isl);
    const slots = bellQueueSlots(isl.scale, layout.radius, Math.max(8, n + 1));
    const q = slots[Math.min(n, slots.length - 1)];
    return {
      x: base.x + q.dx,
      y: base.y + q.dy,
      side: q.side,
      base,
      scale: isl.scale,
      lookX: base.x,
      lookY: base.y - isl.fp.top * 0.5,
    };
  }

  /** Advance a hop along an arc toward (tx, ty); true once it has landed. */
  function stepHop(s, dt, tx, ty) {
    const h = s.hop;
    h.age += dt;
    const k = clamp(h.age / h.dur, 0, 1);
    const to = { x: tx, y: ty };
    const lift = Math.max(50, Math.hypot(tx - h.from.x, ty - h.from.y) * 0.35);
    const ctl = { x: (h.from.x + tx) / 2, y: Math.min(h.from.y, ty) - lift };
    const p = quad(h.from, ctl, to, ease.inOutSine(k));
    s.x.x = p.x;
    s.y.x = p.y;
    s.x.v = 0;
    s.y.v = 0;
    if (k >= 1) {
      s.hop = null;
      return true;
    }
    return false;
  }

  function update(dt) {
    time += dt;
    frameDt = dt;
    if (needsLayout) relayout();
    updateIslands(dt);

    for (const s of sprites.values()) {
      s.age += dt;
      s.statusAge += dt;
      s.throwAge += dt;
      s.celebrateAge += dt;
      s.shockAge += dt;
      s.flashAge += dt;
      if (s.age < 0) continue;

      // Life cycle: entering pops in, leaving waves then walks off the nearest edge.
      if (s.life === 'enter') {
        const k = clamp(s.age / (reduced ? 0.4 : 0.6), 0, 1);
        s.alpha = reduced ? k : 1;
        s.scale = reduced ? 1 : s.enterFrom && !s.enterFrom.landed ? lerp(0.35, 1, ease.outBack(k)) : ease.outBack(k);
        if (k >= 1) {
          s.life = 'live';
          if (!reduced && s.enterFrom) burst(s.homeX, s.homeY - s.homeR, 'sparkle', 8);
          s.enterFrom = null;
        }
      } else if (s.life === 'leave') {
        s.leaveAge += dt;
        if (reduced) {
          s.alpha = 1 - clamp(s.leaveAge / 0.6, 0, 1);
          if (s.alpha <= 0) sprites.delete(s.id);
          continue;
        }
        if (s.leaveAge > 1.1 && layout?.islets) {
          // ── islands / wander ── hop off the island and away off-screen.
          s.hop ??= {
            from: { x: s.x.x, y: s.y.x },
            to: { x: s.leaveDir < 0 ? -s.homeR * 4 : W + s.homeR * 4, y: s.y.x + 40 },
            age: 0,
            dur: 1.1,
          };
          s.alpha = 1 - clamp((s.hop.age / s.hop.dur - 0.7) / 0.3, 0, 1);
          if (stepHop(s, dt, s.hop.to.x, s.hop.to.y)) sprites.delete(s.id);
          continue;
        }
        if (s.leaveAge > 1.1) {
          const speed = 70 + s.homeR * 3;
          s.x.x += s.leaveDir * speed * dt;
          s.x.v = s.leaveDir * speed;
          const out = s.leaveDir < 0 ? -s.x.x : s.x.x - W;
          s.alpha = clamp(1 - out / (s.homeR * 2), 0, 1);
          if (out > s.homeR * 2.5) sprites.delete(s.id);
        }
        continue;
      } else if (s.life === 'gone') continue;

      // Movement: spring toward home (or the bell when visiting the human).
      let tx = s.homeX,
        ty = s.homeY;
      // ── islands / wander ── home is a wandering point on the island, or the bell queue.
      let place = 'home';
      const iv = s.home && islandViz.get(s.home.taskId);
      if (iv) {
        if (!reduced && !s.hop) stepWander(s.wander, dt, s.rand, { ...wanderPace(s.status), around: wanderAround(s) });
        const p = islandPoint(iv, s.wander.u, s.wander.v, s.r.x);
        tx = p.x;
        ty = p.y + iv.bob;
        place = 'island';
      }
      const qi = bellQueue.indexOf(s.id);
      if (qi >= 0 && layout.islets) {
        // Needs you: queue outside the "you" islet's building, looking at it.
        const q = youSpot(qi);
        tx = q.x;
        ty = q.y;
        place = 'bell';
        s.lookAt = { x: q.lookX, y: q.lookY };
        s.lookUntil = time + 0.2;
      }
      if (s.visit) {
        const v = s.visit;
        v.age += dt;
        const lm = v.lm;
        const inward = lm.side === 'left' ? 1 : lm.side === 'right' ? -1 : 0;
        let vx = lm.x + inward * (lm.r + s.r.x * 1.3),
          vy = lm.y + (lm.side === 'top' ? lm.r + s.r.x * 2.4 : lm.side === 'bottom' ? -lm.r : lm.r * 0.6);
        if (lm.kind === 'human' && layout.islets) {
          const q = youSpot(bellQueue.length);
          vx = q.x;
          vy = q.y;
        }
        place = 'visit';
        if (v.stage === 'go') {
          tx = vx;
          ty = vy;
          if (Math.hypot(s.x.x - vx, s.y.x - vy) < 6 || v.age > 2.2) {
            v.stage = 'ring';
            v.age = 0;
            hitLandmark(lm, v.label);
          }
        } else if (v.stage === 'ring') {
          tx = vx;
          ty = vy;
          s.lookAt = { x: lm.x, y: lm.y };
          s.lookUntil = time + 0.2;
          if (v.age > 1.3) s.visit = null;
        }
      }
      // ── islands / wander ── changing place (island ↔ bell) is a hop through the air.
      if (s.place && place !== s.place && layout.islets && !reduced && s.life === 'live') {
        s.hop = {
          from: { x: s.x.x, y: s.y.x },
          age: 0,
          dur: clamp(Math.hypot(tx - s.x.x, ty - s.y.x) / 420, 0.55, 1.1),
        };
      }
      s.place = place;
      if (reduced && layout.islets && s.life === 'live') {
        s.hop = null;
        placeAt(s, tx, ty);
      } else if (s.hop) stepHop(s, dt, tx, ty);
      else if (!s.enterFrom || s.enterFrom.landed) {
        springStep(s.x, tx, dt, 40, 2 * Math.sqrt(40) * 1.05);
        springStep(s.y, ty, dt, 40, 2 * Math.sqrt(40) * 1.05);
      } else {
        // Lobbed out of the parent along an arc.
        const k = ease.outQuad(clamp(s.age / 0.6, 0, 1));
        const ctl = { x: (s.enterFrom.x + tx) / 2, y: Math.min(s.enterFrom.y, ty) - s.homeR * 4 };
        const p = quad(s.enterFrom, ctl, { x: tx, y: ty }, k);
        s.x.x = p.x;
        s.y.x = p.y;
      }
      springStep(s.r, s.homeR, dt, 60);

      // Blinks (sometimes double).
      s.blinkAge += dt;
      if (time >= s.blinkAt) {
        s.blinkAge = 0;
        s.blinkAt = time + (s.rand() < 0.2 ? 0.28 : 2 + s.rand() * 4);
      }

      if (reduced) continue;
      // Status-driven particles.
      const r = s.r.x;
      if (s.status === 'working') {
        const P = 0.62 + s.hopRhythm * 0.02;
        const p = ((time + s.phase) / P) % 1;
        if (s.hopP < 0.75 && p >= 0.75) puff(s.cx, s.y.x, 'dust');
        s.hopP = p;
        s.spin += dt * 18;
      } else if (s.status === 'error') {
        s.smokeT -= dt;
        if (s.smokeT <= 0) {
          puff(s.cx + (s.rand() - 0.5) * r * 0.6, s.cy - r * 1.9, 'smoke');
          s.smokeT = 0.9 + s.rand() * 0.6;
        }
      } else if (s.status === 'asleep') {
        s.zT -= dt;
        if (s.zT <= 0) {
          addParticle({
            type: 'z',
            x: s.cx + r * 0.6,
            y: s.cy - r * 1.2,
            vx: 9,
            vy: -14,
            life: 2.4,
            size: clamp(r * 0.6, 9, 15),
            drag: 1,
            phase: s.rand() * TAU,
          });
          s.zT = 1.6 + s.rand() * 0.6;
        }
      } else s.spin += dt * 4;
    }

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.age += dt;
      if (p.kind === 'terminal' && !p.fadeAt && rnd() < 0.7) {
        const pos = quad(p.p0, p.p1, p.p2, Math.min(1, p.age / p.dur));
        addParticle({
          type: 'spark',
          x: pos.x,
          y: pos.y,
          vx: (rnd() - 0.5) * 30,
          vy: (rnd() - 0.5) * 30,
          life: 0.35,
          size: 1.5 + rnd(),
          color: pal.yellow,
          drag: 0.9,
        });
      }
      if (p.age >= p.dur) {
        projectiles.splice(i, 1);
        if (p.onHit) p.onHit();
        else if (p.last) hitLandmark(p.lm, p.label);
        else {
          const st = lmState.get(p.lm.kind);
          st.pulseAge = Math.min(st.pulseAge, 0.05);
        }
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age < 0) continue;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      const drag = p.drag ** (dt * 60);
      p.vx *= drag;
      p.vy = p.vy * drag + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      floaters[i].age += dt;
      if (floaters[i].age > floaters[i].dur) floaters.splice(i, 1);
    }
    for (const st of lmState.values()) {
      st.pulseAge += dt;
      st.ringAge += dt;
      st.glowAge += dt;
      st.wiggleAge += dt;
    }
  }

  // ── poses ──────────────────────────────────────────────────────────────────

  const REST = {
    dx: 0,
    dy: 0,
    sx: 1,
    sy: 1,
    rot: 0,
    glow: 0,
    lift: 0,
    feetDrop: 0,
    lookX: 0,
    lookY: 0,
    lidTop: 0,
    lidBot: 0,
    lidTilt: 0,
  };
  // Lids per status: focused while working, pondering while thinking, wide when it needs you.
  const FOCUSED = { lidTop: 0.1, lidBot: 0.24, lidTilt: 0.03 };
  const PONDER = { lidTop: 0, lidBot: 0.08 };
  const RELAXED = { lidTop: 0, lidBot: 0.2, mouth: 'smile' };
  const SITTING = { sx: 1.06, sy: 0.93, feetDrop: -0.15, lookY: 0.15 };

  /** Idle critters doze: mostly asleep, now and then a heavy-lidded peek that droops shut. */
  function dozeLid(t) {
    const q = (t / 9) % 1;
    if (q < 0.58) return 1;
    if (q < 0.63) return lerp(1, 0.42, ease.outQuad((q - 0.58) / 0.05));
    if (q < 0.9) return lerp(0.42, 0.8, (q - 0.63) / 0.27);
    return lerp(0.8, 1, (q - 0.9) / 0.1);
  }

  function statusPose(s, status, r) {
    const t = time + s.phase;
    if (reduced) {
      const base = { ...REST, eyes: 'open', mouth: 'smile', wave: null };
      if (status === 'asleep') return { ...base, lidTop: 1, mouth: 'small-o' };
      if (status === 'idle') return { ...base, ...RELAXED };
      if (status === 'finished') return { ...base, ...SITTING, lidTop: 0.08, mouth: 'smile' };
      if (status === 'needs-you') return { ...base, eyes: 'wide', mouth: 'o', glow: 0.7, wave: -0.9 };
      if (status === 'error') return { ...base, eyes: 'spiral', mouth: 'wavy' };
      if (status === 'thinking') return { ...base, ...PONDER, mouth: 'hmm', lookX: 0.4, lookY: -0.8 };
      if (status === 'working') return { ...base, ...FOCUSED, mouth: 'cat' };
      if (status === 'archived') return { ...base, eyes: 'happy', wave: -0.9 };
      return base;
    }
    switch (status) {
      case 'working': {
        const P = 0.62 + s.hopRhythm * 0.02;
        const p = (t / P) % 1;
        const drift = Math.sin(t * 0.9) * r * 0.25;
        if (p < 0.75) {
          const q = p / 0.75,
            h = 4 * q * (1 - q),
            vel = 1 - 2 * q;
          const st = 0.13 * Math.abs(vel);
          return {
            ...REST,
            ...FOCUSED,
            dx: drift,
            dy: -h * r * 0.75,
            sx: 1 - st * 0.6,
            sy: 1 + st,
            lift: h,
            feetDrop: h * 0.7,
            lookX: Math.cos(t * 0.9) * 0.6,
            eyes: 'open',
            mouth: 'cat',
            wave: null,
          };
        }
        const q = (p - 0.75) / 0.25,
          sq = Math.sin(Math.PI * q) * 0.2;
        return {
          ...REST,
          ...FOCUSED,
          dx: drift,
          sx: 1 + sq * 0.8,
          sy: 1 - sq,
          lookX: Math.cos(t * 0.9) * 0.6,
          eyes: 'open',
          mouth: 'cat',
          wave: null,
        };
      }
      case 'thinking': {
        const b = Math.sin(t * 1.4);
        return {
          ...REST,
          ...PONDER,
          dy: -(b * 0.5 + 0.5) * r * 0.2,
          sx: 1 + b * 0.02,
          sy: 1 - b * 0.02,
          rot: Math.sin(t * 0.7) * 0.06,
          lift: 0.15 * (b * 0.5 + 0.5),
          lookX: 0.45 + Math.sin(t * 0.5) * 0.3,
          lookY: -0.9,
          eyes: 'open',
          mouth: 'hmm',
          wave: null,
        };
      }
      case 'needs-you': {
        const q = (t % 1.3) / 1.3;
        let dy = 0,
          sx = 1,
          sy = 1,
          lift = 0;
        if (q < 0.45) {
          const k = q / 0.45,
            h = 4 * k * (1 - k);
          dy = -h * r * 0.55;
          sy = 1 + 0.08 * Math.abs(1 - 2 * k);
          sx = 2 - sy;
          lift = h;
        } else if (q < 0.6) {
          const sq = Math.sin((Math.PI * (q - 0.45)) / 0.15) * 0.16;
          sx = 1 + sq * 0.8;
          sy = 1 - sq;
        }
        const human = layout?.landmarks.find((l) => l.kind === 'human');
        const lx = human ? clamp((human.x - s.cx) / 200, -1, 1) : 0;
        return {
          ...REST,
          dy,
          sx,
          sy,
          lift,
          feetDrop: lift * 0.6,
          glow: 0.45 + 0.4 * Math.sin(t * 4),
          wave: -0.5 + Math.sin(t * 11) * 0.65,
          lookX: lx,
          lookY: -0.2,
          eyes: 'wide',
          mouth: 'o',
        };
      }
      case 'error': {
        const w = Math.sin(t * 7);
        return {
          ...REST,
          dx: w * r * 0.08,
          rot: w * 0.13,
          sx: 1 + Math.abs(w) * 0.03,
          eyes: 'spiral',
          mouth: 'wavy',
          wave: null,
        };
      }
      case 'archived':
        return { ...REST, eyes: 'happy', mouth: 'smile', wave: -0.4 + Math.sin(t * 9) * 0.7 };
      case 'asleep': {
        const b = Math.sin(t * 1.1);
        return {
          ...REST,
          sx: 1 - 0.035 * b,
          sy: 1 + 0.045 * b,
          eyes: 'open',
          lidTop: dozeLid(t),
          lidBot: 0.1,
          mouth: 'small-o',
          wave: null,
        };
      }
      case 'finished': {
        // Sitting, calm, looking out at you with a result: a slow breath and a gentle sway.
        const b = Math.sin(t * 1.3);
        return {
          ...REST,
          ...SITTING,
          sx: SITTING.sx - 0.02 * b,
          sy: SITTING.sy + 0.025 * b,
          rot: Math.sin(t * 0.8) * 0.035,
          eyes: 'open',
          lidTop: 0.08,
          mouth: 'smile',
          wave: null,
        };
      }
      default: {
        // Awake and relaxed at the prompt: easy breathing, soft lids, eyes drifting a little.
        const b = Math.sin(t * 1.1);
        return {
          ...REST,
          ...RELAXED,
          sx: 1 - 0.025 * b,
          sy: 1 + 0.03 * b,
          lookX: Math.sin(t * 0.35) * 0.4,
          lookY: Math.sin(t * 0.23) * 0.2,
          eyes: 'open',
          wave: null,
        };
      }
    }
  }

  function blendPose(a, b, w) {
    const o = { ...b };
    for (const k of [
      'dx',
      'dy',
      'sx',
      'sy',
      'rot',
      'glow',
      'lift',
      'feetDrop',
      'lookX',
      'lookY',
      'lidTop',
      'lidBot',
      'lidTilt',
    ])
      o[k] = lerp(a[k] || 0, b[k] || 0, w);
    if (w < 0.5) {
      o.eyes = a.eyes;
      o.mouth = a.mouth;
      o.wave = a.wave;
    }
    return o;
  }

  function poseFor(s) {
    const r = s.r.x;
    let pose = statusPose(s, s.status, r);
    if (s.statusAge < STATUS_BLEND)
      pose = blendPose(statusPose(s, s.prevStatus, r), pose, ease.inOutSine(s.statusAge / STATUS_BLEND));
    if (reduced) {
      if (s.flashAge < (s.flashDur || 1)) {
        pose.glow = Math.max(pose.glow, 1 - s.flashAge / (s.flashDur || 1));
        pose.glowColor = s.flashColor;
      }
      if (s.celebrateAge < 1.6) {
        pose.eyes = 'happy';
        pose.mouth = 'grin';
      }
      return glance(s, pose, r);
    }

    // ── personality hooks ── rare idle behaviours, layered over the status pose.
    if (s.life === 'live' && !s.visit) {
      const b = s.mind.at(time, { status: s.status, reduced, neighbours: neighboursOf(s) });
      const t = b?.target && sprites.get(b.target);
      const dir = t ? unit(t.cx - s.cx, t.cy - s.cy) : null;
      pose = applyBehaviour(pose, b, r, dir);
      if (b?.kind === 'chat' && t)
        t.attn = { id: s.id, until: time + 0.25 }; // the friend looks back
      else if (!b && s.attn && time < s.attn.until) {
        const c = sprites.get(s.attn.id);
        if (c) {
          const d = unit(c.cx - s.cx, c.cy - s.cy);
          pose.lookX = d.x;
          pose.lookY = clamp(d.y, -0.5, 0.5);
          pose.lidTop = Math.min(pose.lidTop || 0, 0.3);
        }
      } else if (!b && s.status === 'thinking') {
        // Busy elsewhere: every few seconds, check on a working child.
        const q = ((time + s.phase * 2) / 6) % 1;
        const kid =
          q < 0.3 &&
          [...sprites.values()].find((k) => k.data.parentId === s.id && k.status === 'working' && k.life === 'live');
        if (kid) {
          const d = unit(kid.cx - s.cx, kid.cy - s.cy),
            w = Math.sin((Math.PI * q) / 0.3);
          pose.lookX = lerp(pose.lookX, d.x, w);
          pose.lookY = lerp(pose.lookY, clamp(d.y, -0.5, 0.5), w);
        }
      }
    }

    // Walking waddle whenever the critter is travelling.
    const speed = Math.hypot(s.x.v, s.y.v);
    if (s.life === 'leave' && s.leaveAge < 1.1) {
      Object.assign(pose, { eyes: 'happy', mouth: 'smile', wave: -0.4 + Math.sin(time * 9) * 0.7, dy: 0, dx: 0 });
    }
    if (speed > 25 && (!s.enterFrom || s.enterFrom.landed)) {
      const amt = clamp(speed / 120, 0, 1),
        w = Math.sin(time * 15 + s.phase);
      pose.dy = pose.dy * (1 - amt) - Math.abs(w) * r * 0.22 * amt;
      pose.rot = pose.rot * (1 - amt) + w * 0.12 * amt;
      pose.feetStep = w * amt;
      pose.dx *= 1 - amt;
      pose.lookX = clamp(s.x.v / 120, -1, 1);
      s.flip = s.x.v < -10;
    } else if (speed < 5) s.flip = false;

    // Status-change pop.
    if (s.statusAge < 0.35) {
      const k = Math.sin((Math.PI * s.statusAge) / 0.35) * 0.18;
      pose.sy *= 1 + k;
      pose.sx *= 1 - k * 0.6;
    }
    // Throw wind-up / release.
    if (s.throwAge < 0.35) {
      const k = s.throwAge / 0.35;
      const sq = k < 0.4 ? -Math.sin((Math.PI * k) / 0.4) * 0.15 : Math.sin((Math.PI * (k - 0.4)) / 0.6) * 0.12;
      pose.sy *= 1 + sq;
      pose.sx *= 1 - sq * 0.7;
      pose.mouth = 'o';
    }
    // Error event: violent shudder.
    if (s.shockAge < 0.9) {
      const k = 1 - s.shockAge / 0.9;
      pose.rot += Math.sin(s.shockAge * 38) * 0.28 * k;
      pose.dx += Math.sin(s.shockAge * 38) * r * 0.15 * k;
      pose.eyes = 'spiral';
      pose.mouth = 'wavy';
    }
    // Done: big jump with a flip.
    if (s.celebrateAge < 1.5) {
      const k = s.celebrateAge / 1.5;
      const jump = k < 0.55 ? 4 * (k / 0.55) * (1 - k / 0.55) : 0;
      pose.dy = -jump * r * 1.8;
      pose.lift = jump;
      pose.rot = k < 0.55 ? ease.inOutCubic(k / 0.55) * TAU : 0;
      pose.eyes = 'happy';
      pose.mouth = 'grin';
      pose.wave = Math.sin(time * 12) * 0.6 - 0.6;
      if (k >= 0.55 && k < 0.7) {
        const sq = Math.sin((Math.PI * (k - 0.55)) / 0.15) * 0.25;
        pose.sx = 1 + sq;
        pose.sy = 1 - sq;
      }
    }
    // Look at a target (landmark being fired at).
    if (s.lookAt && time < s.lookUntil) {
      const dx = s.lookAt.x - s.cx,
        dy = s.lookAt.y - s.cy,
        d = Math.hypot(dx, dy) || 1;
      pose.lookX = dx / d;
      pose.lookY = dy / d;
      if (pose.eyes === 'closed') pose.eyes = 'open';
      pose.lidTop = Math.min(pose.lidTop || 0, 0.3);
    }
    return glance(s, pose, r);
  }

  /** Px above the head taken by a hat or a status bubble, so a label placed above clears it. */
  function headroomOf(s, r) {
    const sc = clamp(r / 18, 0.6, 1.1);
    if (s.status === 'needs-you' || s.status === 'finished') return 25 * sc + r * 0.3; // '!' / '✓' bubble
    if (s.status === 'thinking' || s.status === 'error') return r * (s.accessory === 'none' ? 0.5 : 1);
    return s.accessory === 'none' ? 0 : r * 0.6;
  }

  // ── personality hooks ── eyes: glance at a nearby cursor, then ease the gaze.
  const unit = (dx, dy) => {
    const d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  };
  function neighboursOf(s) {
    const out = [];
    for (const o of sprites.values()) {
      if (o !== s && o.life === 'live' && o.age >= 0 && o.data.taskId === s.data.taskId) out.push(o.id);
    }
    return out;
  }
  function glance(s, pose, r) {
    const busyLooking = s.lookAt && time < s.lookUntil;
    if (pointer && !busyLooking && s.life === 'live' && pose.eyes !== 'spiral') {
      const dx = pointer.x - s.cx,
        dy = pointer.y - s.cy,
        d = Math.hypot(dx, dy);
      if (d < Math.max(90, r * 5) && d > r * 0.6) {
        pose.lookX = dx / d;
        pose.lookY = clamp(dy / d, -0.8, 0.8);
        if (pose.eyes === 'closed') pose.eyes = 'open';
        pose.lidTop = Math.min(pose.lidTop || 0, s.status === 'asleep' ? 0.45 : 0.15);
      }
    }
    // Reduced motion: glances are instant. Otherwise the eyes travel quickly.
    const k = reduced ? 1 : 1 - Math.exp(-frameDt * 14);
    s.gaze.x += ((pose.lookX || 0) - s.gaze.x) * k;
    s.gaze.y += ((pose.lookY || 0) - s.gaze.y) * k;
    pose.lookX = s.gaze.x;
    pose.lookY = s.gaze.y;
    return pose;
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!layout) return;
    const dt = 1 / 60;
    // ── personality hooks ── soft sky (gradient, clouds or stars) behind the scene.
    if (!layout.compact) drawSky(ctx, { W, H, pal, time, reduced });

    // ── islands / wander ── task islands and service islets, back to front.
    const needsYou = [...sprites.values()].filter((s) => s.status === 'needs-you' && s.life !== 'leave').length;
    if (layout.islets) {
      const scene = [
        ...[...islandViz.values()].map((v) => ({
          y: v.cy,
          draw: () => drawIsland(ctx, v, pal, { bob: v.bob, alpha: v.a }),
        })),
        ...layout.islets.map((i) => ({ y: i.y, draw: () => drawServiceIslet(i, needsYou) })),
      ].sort((a, b) => a.y - b.y);
      for (const it of scene) it.draw();
    }

    // Cluster patches + task labels (compact tray), eased toward their targets.
    const seen = new Set();
    for (const c of layout.clusters) {
      seen.add(c.taskId);
      let v = clusterViz.get(c.taskId);
      const rx = c.block.w / 2 + layout.radius * 0.6,
        ry = c.block.h / 2 + layout.radius * 0.2;
      if (!v) {
        v = { cx: c.cx, cy: c.cy, rx, ry, a: 0, name: c.taskName, cell: c.cell, labelY: c.labelY };
        clusterViz.set(c.taskId, v);
      }
      const k = reduced ? 1 : 1 - Math.exp(-dt * 6);
      v.cx += (c.cx - v.cx) * k;
      v.cy += (c.cy - v.cy) * k;
      v.rx += (rx - v.rx) * k;
      v.ry += (ry - v.ry) * k;
      v.labelY += (c.labelY - v.labelY) * k;
      v.a = Math.min(1, v.a + dt * 2.5);
      v.name = c.taskName;
      v.cell = c.cell;
      v.gone = false;
    }
    for (const [id, v] of clusterViz) {
      if (!seen.has(id)) {
        v.a -= dt * 2.5;
        if (v.a <= 0) clusterViz.delete(id);
      }
    }
    for (const v of clusterViz.values()) {
      const g = ctx.createRadialGradient(v.cx, v.cy, 0, v.cx, v.cy, Math.max(v.rx, v.ry));
      const patch = pal.dark ? lighten(pal.bg, 0.06) : darken(pal.bg, 0.05);
      g.addColorStop(0, toCss(patch, v.a));
      g.addColorStop(0.75, toCss(patch, v.a * 0.7));
      g.addColorStop(1, toCss(patch, 0));
      ctx.save();
      ctx.translate(v.cx, v.cy);
      ctx.scale(1, v.ry / Math.max(v.rx, v.ry));
      ctx.translate(-v.cx, -v.cy);
      ctx.fillStyle = g;
      ellipse(ctx, v.cx, v.cy, Math.max(v.rx, v.ry), Math.max(v.rx, v.ry));
      ctx.fill();
      ctx.restore();
    }

    // ── personality hooks ── fireflies / petals, behind everything that moves.
    drawAmbient(ctx, { W, H, pal, time, reduced, areas: layout.islands });

    // Landmarks (the compact tray's strip; the full pen draws them as islets above).
    for (const lm of layout.compact ? layout.landmarks : []) {
      const st = lmState.get(lm.kind);
      const pulse = reduced
        ? 0
        : st.pulseAge < 0.55
          ? Math.sin((Math.PI * st.pulseAge) / 0.55) * (1 - (st.pulseAge / 0.55) * 0.4)
          : 0;
      let glow = st.glowAge < 1.2 ? 1 - st.glowAge / 1.2 : 0;
      let wiggle = !reduced && st.wiggleAge < 1.3 ? Math.sin(st.wiggleAge * 28) * 0.3 * (1 - st.wiggleAge / 1.3) : 0;
      if (lm.kind === 'human' && needsYou) {
        glow = Math.max(glow, reduced ? 0.6 : 0.35 + 0.25 * Math.sin(time * 4));
        if (!reduced) {
          const q = time % 2.6;
          if (q < 0.6) wiggle += Math.sin(q * 30) * 0.18 * (1 - q / 0.6);
        }
      }
      drawBuilding(
        ctx,
        lm,
        pal,
        {
          pulse,
          glow,
          wiggle,
          ring: !reduced && st.ringAge < 0.7 ? st.ringAge / 0.7 : null,
        },
        LANDMARK_LABELS[lm.kind],
        reduced ? 0 : time,
        layout.compact,
      );
    }

    // Compute render positions first (leashes need them).
    const list = [];
    for (const s of sprites.values()) {
      if (s.age < 0 || s.life === 'gone') continue;
      const pose = poseFor(s);
      const r = s.r.x * s.scale;
      s.cx = s.x.x + pose.dx;
      s.cy = s.y.x + pose.dy - r;
      s.cr = r;
      list.push({ s, pose, r });
    }

    // ── islands / wander ── leashes: a rope from parent to child, over the
    // islands and under the critters.
    for (const { s } of list) {
      const pid = s.data.parentId;
      const p = pid && sprites.get(pid);
      if (!p || p.age < 0 || p.life === 'gone') continue;
      drawLeash(
        ctx,
        { x: p.cx, y: p.cy + p.cr * 0.45 },
        { x: s.cx, y: s.cy + s.cr * 0.45 },
        pal,
        Math.min(s.alpha, p.alpha),
        reduced ? 0 : time * 0.5,
      );
    }

    list.sort((a, b) => a.s.y.x - b.s.y.x);
    const hoverSprite = hovered ? sprites.get(hovered) : null;
    const labels = [];
    // ── islands / wander ── the front of the phone queue holds the receiver, standing still.
    const holderId = layout.islets && bellQueue[PHONE_HOLDER_SLOT];
    for (const { s, pose, r } of list) {
      const holding = s.id === holderId && s.place === 'bell' && !s.hop && s.life === 'live';
      if (holding) {
        pose.dy = 0;
        pose.lift = 0;
        pose.wave = null;
        pose.feetDrop = 0;
      }
      const color = currentColor(s);
      const groundY = s.y.x;
      drawShadow(ctx, s.x.x + pose.dx, groundY, r, pose.lift, pal, s.alpha);
      const blink = s.blinkAge < 0.16 ? 1 - Math.sin((Math.PI * s.blinkAge) / 0.16) : 1;
      drawCritter(
        ctx,
        {
          x: s.x.x + pose.dx,
          y: groundY + pose.dy,
          r,
          sx: pose.sx,
          sy: pose.sy,
          rot: pose.rot,
          color,
          alpha: s.alpha,
          eyes: pose.eyes,
          mouth: pose.mouth,
          blink,
          wave: pose.wave,
          lidTop: pose.lidTop,
          lidBot: pose.lidBot,
          lidTilt: pose.lidTilt,
          mouthOpen: pose.mouthOpen,
          armsUp: pose.armsUp,
          lookX: pose.lookX,
          lookY: pose.lookY,
          feetDrop: pose.feetDrop,
          feetStep: pose.feetStep || 0,
          glow: hovered === s.id ? Math.max(pose.glow, 0.6) : pose.glow,
          glowColor: hovered === s.id ? pal.accent : pose.glowColor,
          accessory: s.accessory,
          tint: s.tint,
          eyeInk: s.eyeInk,
          phase: s.phase,
          spin: s.spin,
          flip: s.flip,
        },
        pal,
        time,
      );
      if (holding) {
        const q = youSpot(PHONE_HOLDER_SLOT),
          sock = phoneSocket(q.scale),
          rs = receiverSpot(r, q.side);
        drawPhoneReceiver(
          ctx,
          q.base.x + sock.dx * q.side,
          q.base.y + sock.dy,
          s.x.x + pose.dx + rs.dx,
          groundY + rs.dy,
          q.scale,
          pal,
          reduced ? 0 : time,
        );
      }

      // Status overlays (drawn upright, outside the squash).
      const headY = s.cy - r * 1.2;
      const a = s.alpha;
      ctx.save();
      ctx.globalAlpha = a;
      if (s.life !== 'leave') {
        const st = s.statusAge < STATUS_BLEND ? ease.outBack(s.statusAge / STATUS_BLEND) : 1;
        if (s.status === 'needs-you') {
          const bob = reduced ? 0 : Math.sin(time * 6 + s.phase) * 2;
          drawBubble(
            ctx,
            s.cx + r * 0.75,
            headY - r * 0.35 + bob,
            '!',
            pal,
            pal.yellow,
            clamp(r / 18, 0.6, 1.1) * st * (reduced ? 1 : 1 + 0.06 * Math.sin(time * 6)),
          );
        } else if (s.status === 'thinking') {
          drawThinkingDots(
            ctx,
            s.cx,
            s.cy - r * 1.45 - (s.accessory === 'none' ? 0 : r * 0.55),
            r * st,
            reduced ? 0.6 : time + s.phase,
            mix(pal.blue, pal.fg, 0.35),
          );
        } else if (s.status === 'error') {
          drawDizzyStars(
            ctx,
            s.cx,
            s.cy - r * 1.3 - (s.accessory === 'none' ? 0 : r * 0.5),
            r * st,
            time + s.phase,
            pal.yellow,
            reduced,
          );
        } else if (s.status === 'finished') {
          const bob = reduced ? 0 : Math.sin(time * 2.2 + s.phase) * 1.5;
          drawBubble(
            ctx,
            s.cx + r * 0.75,
            headY - r * 0.35 + bob,
            '✓',
            pal,
            pal.accent,
            clamp(r / 18, 0.6, 1.1) * st * 0.9,
          );
        } else if (s.status === 'asleep' && reduced) {
          haloText(
            ctx,
            'z',
            s.cx + r * 0.9,
            s.cy - r * 1.2,
            pal,
            0.7,
            `700 ${Math.round(clamp(r * 0.55, 8, 13))}px system-ui, sans-serif`,
            mix(pal.fg, pal.blue, 0.4),
          );
        }
        if (pose.bubble) drawChatBubble(ctx, s.cx, headY - r * 0.1, pose.bubble, pal, r); // ── personality hooks ──
      }
      ctx.restore();

      // Name label (the hovered critter's full name is in the tooltip, and
      // its neighbours' labels step back so nothing collides).
      const font = s.role === 'parent' ? FONT_NAME_PARENT : FONT_NAME;
      const labelKey = `${s.data.name}|${s.data.taskName}|${labelWidth}|${font}`;
      if (s.labelFor !== labelKey) {
        // The island plank already names the task; keep the part that tells
        // sessions apart, cutting from the middle if it still doesn't fit.
        ctx.font = font;
        const full = stripTaskPrefix(s.data.name || s.id, s.data.taskName);
        s.label = truncateMiddle(full, labelWidth, (t) => ctx.measureText(t).width);
        s.labelShort = shortLabel(full, labelWidth, (t) => ctx.measureText(t).width);
        s.labelFor = labelKey;
      }
      if (!layout.compact && hovered !== s.id) {
        const near =
          hoverSprite &&
          Math.abs(hoverSprite.y.x - groundY) < 30 &&
          Math.abs(hoverSprite.x.x - s.x.x) < labelWidth * 1.5;
        labels.push({
          id: s.id,
          text: s.label,
          short: s.labelShort,
          x: s.x.x,
          groundY,
          r,
          status: s.status,
          parent: s.role === 'parent',
          font,
          body: { cx: s.cx, cy: s.cy, cr: s.cr },
          headroom: headroomOf(s, r),
          alpha: (s.status === 'asleep' ? 0.6 : 0.85) * a * (near ? 0.2 : 1),
        });
      }
    }

    // ── islands / wander ── name labels over all critters, placed most
    // important first (labels.js); one with no clear spot steps back to a whisper.
    ctx.font = FONT_NAME;
    const byId = new Map(labels.map((l) => [l.id, l]));
    const measure = (t, it) => {
      ctx.font = it?.font || FONT_NAME;
      return ctx.measureText(t).width;
    };
    for (const l of placeLabels(labels, measure, labelObstacles(), { l: 0, t: 0, r: W, b: H })) {
      const it = byId.get(l.id);
      if (!l.hidden) haloText(ctx, l.text, l.x, l.y, pal, it.alpha * (l.visible ? 1 : 0.12), it.font);
    }

    // Particles.
    for (const p of particles) {
      if (p.age < 0) continue;
      const k = p.age / p.life;
      switch (p.type) {
        case 'dust':
          ctx.fillStyle = toCss(mix(pal['surface-2'], pal.fg, 0.2), 0.5 * (1 - k));
          ellipse(ctx, p.x, p.y, p.size * (1 + k), p.size * (1 + k) * 0.8);
          ctx.fill();
          break;
        case 'smoke': {
          // A little three-lobed cloud that swells and fades as it rises.
          const c = pal.dark ? mix(pal['surface-2'], pal.fg, 0.7) : mix(pal['surface-2'], pal.fg, 0.25);
          const sz = p.size * (1 + k * 1.6);
          ctx.fillStyle = toCss(c, (pal.dark ? 0.35 : 0.5) * (1 - k));
          ctx.beginPath();
          ctx.arc(p.x - sz * 0.6, p.y + sz * 0.2, sz * 0.7, 0, TAU);
          ctx.moveTo(p.x + sz * 1.3, p.y + sz * 0.2);
          ctx.arc(p.x + sz * 0.6, p.y + sz * 0.2, sz * 0.7, 0, TAU);
          ctx.moveTo(p.x + sz, p.y - sz * 0.15);
          ctx.arc(p.x, p.y - sz * 0.15, sz, 0, TAU);
          ctx.fill();
          break;
        }
        case 'z':
          haloText(
            ctx,
            'z',
            p.x + Math.sin(p.age * 2 + p.phase) * 4,
            p.y,
            pal,
            (1 - k) * 0.8,
            `700 ${Math.round(p.size * (0.7 + k * 0.6))}px system-ui, sans-serif`,
            mix(pal.fg, pal.blue, 0.4),
          );
          break;
        case 'spark':
          ctx.fillStyle = toCss(p.color || pal.yellow, 1 - k);
          ellipse(ctx, p.x, p.y, p.size * (1 - k * 0.5), p.size * (1 - k * 0.5));
          ctx.fill();
          break;
        case 'sparkle':
          drawStar(ctx, p.x, p.y, p.size * 1.6 * (1 - k * 0.6), p.rot, p.color || pal.yellow, 1 - k);
          break;
        case 'confetti':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.age * 9 + p.rot));
          ctx.fillStyle = toCss(p.color, k > 0.75 ? (1 - k) * 4 : 1);
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
          ctx.restore();
          break;
      }
    }

    // Projectiles.
    for (const p of projectiles) {
      if (p.delay > 0) continue;
      if (p.fadeAt) {
        // reduced motion: fade into the keeper's mouth, no flight
        ctx.save();
        ctx.globalAlpha *= 1 - clamp(p.age / p.dur, 0, 1);
        drawProjectile(ctx, p.kind, p.fadeAt.x, p.fadeAt.y, 0, 0, pal, clamp(layout.radius / 16, 0.75, 1.25));
        ctx.restore();
        continue;
      }
      const k = clamp(p.age / p.dur, 0, 1);
      const tk = p.kind === 'web' ? ease.inOutSine(k) : k;
      const pos = quad(p.p0, p.p1, p.p2, tk);
      if (p.sway) pos.x += Math.sin(k * Math.PI * 3) * p.sway * (1 - k);
      if (p.kind === 'spawn') {
        drawCritter(
          ctx,
          {
            x: pos.x,
            y: pos.y + p.r,
            r: p.r,
            color: p.color,
            eyes: 'happy',
            mouth: 'smile',
            accessory: 'none',
            rot: k * TAU,
          },
          pal,
          time,
        );
      } else {
        const pop = k < 0.12 ? ease.outBack(k / 0.12) : 1;
        drawProjectile(
          ctx,
          p.kind,
          pos.x,
          pos.y,
          quadAngle(p.p0, p.p1, p.p2, tk),
          p.age,
          pal,
          pop * clamp(layout.radius / 16, 0.75, 1.25),
        );
      }
    }

    // ── islands / wander ── name planks over the debris, so a flurry of paper never hides them.
    if (layout.islets) {
      for (const i of layout.islets)
        drawCaptionPlank(ctx, i.x, isletBase(i).captionY, LANDMARK_LABELS[i.kind], pal, i.scale, { kind: i.kind });
      for (const v of islandViz.values()) {
        drawSignpost(ctx, v.cx, v.cy + v.bob + v.ry * 1.3 + 4, v.taskName, pal, {
          scale: clamp(layout.radius / 18, 0.8, 1.15),
          alpha: v.a,
          hang: true,
        });
      }
    }

    // Task labels sit above the debris so a flurry of paper never hides them.
    ctx.font = FONT_TASK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    if ('letterSpacing' in ctx) /** @type {any} */ (ctx).letterSpacing = '0.08em';
    for (const v of clusterViz.values()) {
      const name = truncateToWidth(v.name.toUpperCase(), v.cell.w - 12, (t) => ctx.measureText(t).width);
      ctx.strokeStyle = toCss(pal.bg, 0.6 * v.a);
      ctx.strokeText(name, v.cx, v.labelY);
      ctx.fillStyle = toCss(pal.fg, 0.4 * v.a);
      ctx.fillText(name, v.cx, v.labelY);
    }
    if ('letterSpacing' in ctx) /** @type {any} */ (ctx).letterSpacing = '0px';

    // Floating labels.
    for (const f of floaters) {
      if (f.age < 0) continue;
      const k = f.age / f.dur;
      const a = k < 0.12 ? k / 0.12 : k > 0.7 ? (1 - k) / 0.3 : 1;
      const y = clamp(f.y + (reduced ? 0 : f.dir * ease.outCubic(k) * 26), 12, H - 12);
      ctx.font = FONT_FLOAT;
      const w = f.w;
      const x = clamp(f.x, w / 2 + 2, W - w / 2 - 2);
      ctx.fillStyle = toCss(pal.dark ? lighten(pal['surface-2'], 0.08) : { r: 255, g: 255, b: 255, a: 1 }, 0.95 * a);
      roundRect(ctx, x - w / 2, y - 10, w, 20, 10);
      ctx.fill();
      ctx.strokeStyle = toCss(f.color, a);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = toCss(pal.fg, a);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.text, x, y + 0.5);
    }

    // Hover tooltip for a service keeper: just its name.
    if (hoveredKeeper && layout.islets?.includes(hoveredKeeper)) {
      const hb = keeperHitbox(hoveredKeeper.kind, hoveredKeeper.scale),
        base = isletBase(hoveredKeeper);
      const text = KEEPER_NAMES[hoveredKeeper.kind];
      ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
      const w = ctx.measureText(text).width + 16;
      const x = clamp(base.x + hb.dx, w / 2 + 4, W - w / 2 - 4),
        y = Math.max(16, base.y + hb.dy - hb.r - 14);
      ctx.fillStyle = toCss(pal.fg, 0.92);
      roundRect(ctx, x - w / 2, y - 11, w, 22, 6);
      ctx.fill();
      ctx.fillStyle = toCss(pal.bg);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 0.5);
    }

    // Hover tooltip: full name + status.
    const hs = hovered && sprites.get(hovered);
    if (hs && hs.life !== 'leave') {
      const text = `${hs.data.name} · ${hs.status}`;
      ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
      const w = ctx.measureText(text).width + 16;
      const x = clamp(hs.cx, w / 2 + 4, W - w / 2 - 4);
      const y = Math.max(16, hs.cy - hs.cr * 2.6);
      ctx.fillStyle = toCss(pal.fg, 0.92);
      roundRect(ctx, x - w / 2, y - 11, w, 22, 6);
      ctx.fill();
      ctx.fillStyle = toCss(pal.bg);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 0.5);
    }
  }

  /** One service islet: its carrier, then its building (hit animation, the "you" glow). */
  function drawServiceIslet(i, needsYou) {
    const st = lmState.get(i.kind);
    const hit = reduced ? 0 : clamp(1 - st.pulseAge / 0.9, 0, 1);
    const base = drawCarrier(ctx, 'islet', i.kind, i.x, i.y, i.scale, pal, time, { reduced });
    drawServiceBuilding(ctx, i.kind, base.x, base.y, i.scale, pal, time, {
      hit,
      waiting: i.kind === 'human' && needsYou ? 1 : 0,
      reduced,
    });
    // Its keeper stands in front, catching what's thrown at it (the phone box has none).
    drawKeeper(ctx, i.kind, base.x, base.y, i.scale, pal, time, catchStateAt(keeperLands.get(i.kind) || [], time), {
      reduced,
    });
  }

  // ── loop, sizing, theme, input ─────────────────────────────────────────────

  function setReduced(v) {
    reduced = !!v;
    needsLayout = true;
    // Motion-only leftovers (dust, sparks, confetti) go at once.
    if (reduced) particles.length = 0;
  }

  function frame(ts) {
    raf = 0;
    if (destroyed) return;
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
    lastTs = ts;
    update(dt);
    render();
    schedule();
  }
  function schedule() {
    if (!raf && !destroyed && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else {
      lastTs = 0;
      schedule();
    }
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    const nw = Math.max(1, Math.round(rect.width)),
      nh = Math.max(1, Math.round(rect.height));
    const nd = window.devicePixelRatio || 1;
    if (nw === W && nh === H && nd === dpr) return;
    W = nw;
    H = nh;
    dpr = nd;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    needsLayout = true;
    if (raf === 0 && !document.hidden) {
      update(0);
      render();
    }
  }

  let themeQueued = false;
  function refreshTheme() {
    if (themeQueued) return;
    themeQueued = true;
    requestAnimationFrame(() => {
      themeQueued = false;
      setPalette(readTheme(el, themeMode));
    });
  }
  const mo = new MutationObserver(refreshTheme);
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    mo.observe(n, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'theme'] });
  }
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  // An OS change is the user's latest word, so it wins over the initial option
  // or a setOptions() override. Hosts often pass a snapshot of this very query.
  const onReduce = () => setReduced(mqReduce.matches);
  mqDark.addEventListener?.('change', refreshTheme);
  mqReduce.addEventListener?.('change', onReduce);

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(wrap);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);

  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    const live = [...sprites.values()].filter((s) => s.life !== 'leave' && s.life !== 'gone' && s.age >= 0);
    return pickAt(live, ev.clientX - rect.left, ev.clientY - rect.top);
  }
  const onMove = (ev) => {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }; // ── personality hooks ──
    const s = pick(ev);
    hovered = s ? s.id : null;
    hoveredKeeper = s ? null : pickKeeper(pointer.x, pointer.y); // keepers: a name on hover, no click
    canvas.style.cursor = s ? 'pointer' : '';
  };
  const onLeave = () => {
    hovered = null;
    hoveredKeeper = null;
    pointer = null;
    canvas.style.cursor = '';
  };
  const onClick = (ev) => {
    if (!ev.isTrusted) return; // only a real human click may open a session
    const s = pick(ev);
    if (!s) return;
    s.throwAge = 0;
    opts.onCritterClick?.(s.id);
    el.dispatchEvent(new CustomEvent('critter-click', { detail: { id: s.id }, bubbles: true }));
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', onClick);

  resize();
  schedule();

  return {
    setState,
    emit,
    resize,
    /** Extra (not in the contract): switch theme mode or reduced motion at runtime
     * (null/undefined reducedMotion = follow the OS). An override lasts until the
     * next prefers-reduced-motion change. */
    setOptions(o = {}) {
      if (o.theme) {
        themeMode = o.theme;
        setPalette(readTheme(el, themeMode));
      }
      if ('reducedMotion' in o) setReduced(o.reducedMotion ?? mqReduce.matches);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro?.disconnect();
      mqDark.removeEventListener?.('change', refreshTheme);
      mqReduce.removeEventListener?.('change', onReduce);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
      wrap.remove();
      sprites.clear();
    },
  };
}
