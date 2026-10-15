const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = window.matchMedia('(hover: hover)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const nearest = (angle, step) => Math.round(angle / step) * step;

/* ---------- Physics ----------
   Loose pieces are moved into their stage and simulated in stage coordinates,
   tumbling in 3D on the way down. Each remembers where it came from. */

const GRAVITY = 2200;
const bodies = new Set();
let rafId = null;
let lastTick = 0;

function heapFor(stage) {
  const size = Math.ceil(stage.clientWidth / 4) + 1;
  if (!stage.__heap || stage.__heap.length !== size) stage.__heap = new Float32Array(size);
  return stage.__heap;
}

function heapRange(stage, x, w) {
  const heap = heapFor(stage);
  return [Math.max(0, Math.floor(x / 4)), Math.min(heap.length - 1, Math.ceil((x + w) / 4))];
}

function heapHeight(stage, x, w) {
  const heap = heapFor(stage);
  const [a, b] = heapRange(stage, x, w);
  let max = 0;
  for (let i = a; i <= b; i++) max = Math.max(max, heap[i]);
  return max;
}

function heapAdd(stage, x, w, top) {
  const heap = heapFor(stage);
  const [a, b] = heapRange(stage, x, w);
  for (let i = a; i <= b; i++) heap[i] = Math.max(heap[i], top);
}

function render(b) {
  b.el.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.r}deg) rotateX(${b.rx}deg) rotateY(${b.ry}deg)`;
}

function step(b, dt) {
  const W = b.stage.clientWidth;
  const H = b.stage.clientHeight;
  b.vy += GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.r += b.vr * dt;
  b.rx += b.vrx * dt;
  b.ry += b.vry * dt;

  if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx) * 0.5; }
  if (b.x > W - b.w) { b.x = W - b.w; b.vx = -Math.abs(b.vx) * 0.5; }

  const floor = H - b.h - heapHeight(b.stage, b.x + b.w * 0.2, b.w * 0.6);
  if (b.y < floor) { b.still = 0; return; }

  b.y = floor;
  if (b.vy > 140) {
    b.vy = -b.vy * (b.round ? 0.42 : 0.28);
    b.vx *= 0.85;
    b.vr *= 0.6;
    b.vrx *= 0.5;
    b.vry *= 0.5;
  } else {
    b.vy = 0;
    b.vx *= b.round ? 0.985 : 0.8;
  }

  // Settle flat: face up or face down, never on an edge
  const flat = nearest(b.r, 180);
  const flatX = nearest(b.rx, 180);
  const flatY = nearest(b.ry, 180);
  b.rx += (flatX - b.rx) * 0.25;
  b.ry += (flatY - b.ry) * 0.25;
  b.vrx *= 0.6;
  b.vry *= 0.6;
  if (b.round) {
    b.vr = (b.vx / (b.w / 2)) * (180 / Math.PI);
  } else {
    b.r += (flat - b.r) * 0.25;
    b.vr *= 0.6;
  }

  const level = (b.round || Math.abs(b.r - flat) < 1) && Math.abs(b.rx - flatX) < 1 && Math.abs(b.ry - flatY) < 1;
  if (Math.abs(b.vx) < 6 && b.vy === 0 && level && ++b.still > 8) {
    b.settled = true;
    if (!b.round) b.r = flat;
    b.rx = flatX;
    b.ry = flatY;
    heapAdd(b.stage, b.x + b.w * 0.15, b.w * 0.7, (H - b.y) * 0.96);
  }
}

function tick(now) {
  const dt = Math.max(0, Math.min(0.032, (now - lastTick) / 1000));
  lastTick = now;
  let active = false;
  for (const b of bodies) {
    if (b.settled || b.tween) continue;
    step(b, dt);
    render(b);
    active = true;
  }
  rafId = active ? requestAnimationFrame(tick) : null;
}

function wake() {
  if (rafId) return;
  lastTick = performance.now();
  rafId = requestAnimationFrame(tick);
}

function markDirty(stage, dirty = true) {
  stage.parentNode.classList.toggle('dirty', dirty);
}

function addBody(el, stage, o) {
  el.classList.add('piece');
  const b = {
    el, stage,
    x: o.x, y: o.y, r: o.rotation || 0, rx: 0, ry: 0,
    ox: o.x, oy: o.y, or: o.rotation || 0,
    vx: o.vx || 0, vy: o.vy || 0, vr: o.vr || 0, vrx: o.vrx || 0, vry: o.vry || 0,
    w: el.offsetWidth, h: el.offsetHeight,
    round: !!o.round,
    onRestore: o.onRestore,
    settled: false, still: 0, tween: false,
  };
  bodies.add(b);
  render(b);
  markDirty(stage);
  if (reduced) {
    for (let i = 0; i < 1500 && !b.settled; i++) step(b, 1 / 60);
    render(b);
  } else {
    wake();
  }
  return b;
}

// Lift an element out of its parent, keep it visually in place, and let it fall
function detach(el, stage, opts = {}) {
  const sr = stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  stage.appendChild(el);
  return addBody(el, stage, {
    ...opts,
    x: r.left + r.width / 2 - sr.left - w / 2,
    y: r.top + r.height / 2 - sr.top - h / 2,
  });
}

function tweenHome(b, done) {
  b.tween = true;
  const sx = b.x, sy = b.y, sr = b.r, srx = b.rx, sry = b.ry;
  const tr = b.or + nearest(sr - b.or, 360);
  const trx = nearest(srx, 360);
  const tryy = nearest(sry, 360);
  const dur = reduced ? 0 : rand(700, 900);
  const t0 = performance.now();
  const frame = (now) => {
    const t = dur ? Math.min(1, (now - t0) / dur) : 1;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    b.x = lerp(sx, b.ox, e);
    b.y = lerp(sy, b.oy, e) - Math.sin(Math.PI * t) * 70;
    b.r = lerp(sr, tr, e);
    b.rx = lerp(srx, trx, e);
    b.ry = lerp(sry, tryy, e);
    render(b);
    if (t < 1) requestAnimationFrame(frame);
    else done();
  };
  requestAnimationFrame(frame);
}

function repair(stage) {
  stage.__beforeRepair?.();
  const list = [...bodies].filter((b) => b.stage === stage && !b.tween);
  const finish = () => {
    heapFor(stage).fill(0);
    stage.__afterRepair?.();
    markDirty(stage, false);
  };
  if (!list.length) { finish(); return; }
  let pending = list.length;
  for (const b of list) {
    tweenHome(b, () => {
      bodies.delete(b);
      b.el.classList.remove('piece');
      b.el.style.cssText = '';
      b.onRestore?.(b);
      if (--pending === 0) finish();
    });
  }
}

document.querySelectorAll('[data-reset]').forEach((btn) => {
  btn.addEventListener('click', () => repair(btn.parentNode.querySelector('[data-stage]')));
});

/* ---------- Hero: extruded headline that turns toward the pointer ---------- */
(() => {
  const h1 = document.querySelector('[data-extrude]');
  if (!h1 || reduced) return;
  let tx = 0.15, ty = -0.2, cx = tx, cy = ty;
  let lastMove = 0;
  const layers = 11;

  window.addEventListener('pointermove', (e) => {
    tx = e.clientX / window.innerWidth - 0.5;
    ty = e.clientY / window.innerHeight - 0.5;
    lastMove = performance.now();
  });

  function frame(now) {
    // Without a pointer it drifts slowly on its own
    if (!canHover || now - lastMove > 4000) {
      tx = Math.sin(now / 2600) * 0.35;
      ty = Math.cos(now / 3400) * 0.25 - 0.1;
    }
    cx += (tx - cx) * 0.06;
    cy += (ty - cy) * 0.06;
    const dx = -cx * 1.1;
    const dy = -cy * 1.1 + 0.55;
    const shadow = [];
    for (let i = 1; i <= layers; i++) {
      const color = i <= layers * 0.35 ? 'var(--accent)' : 'var(--accent-deep)';
      shadow.push(`${(dx * i).toFixed(2)}px ${(dy * i).toFixed(2)}px 0 ${color}`);
    }
    shadow.push(`${(dx * layers * 1.6).toFixed(1)}px ${(dy * layers * 1.6 + 14).toFixed(1)}px 34px rgb(0 0 0 / 0.2)`);
    h1.style.textShadow = shadow.join(', ');
    h1.style.transform = `perspective(1400px) rotateX(${(-cy * 12).toFixed(2)}deg) rotateY(${(cx * 16).toFixed(2)}deg)`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ---------- Stages tilt toward the pointer ---------- */
(() => {
  if (reduced || !canHover) return;
  const frames = [...document.querySelectorAll('.frame')].map((f) => ({
    f, stage: f.querySelector('[data-stage]'), tx: 0, ty: 0, cx: 0, cy: 0,
  }));
  frames.forEach((s) => {
    s.f.addEventListener('pointermove', (e) => {
      const r = s.f.getBoundingClientRect();
      s.tx = (e.clientX - r.left) / r.width - 0.5;
      s.ty = (e.clientY - r.top) / r.height - 0.5;
    });
    s.f.addEventListener('pointerleave', () => { s.tx = 0; s.ty = 0; });
  });
  function frame() {
    for (const s of frames) {
      s.cx += (s.tx - s.cx) * 0.07;
      s.cy += (s.ty - s.cy) * 0.07;
      s.stage.style.transform = `rotateX(${(-s.cy * 6).toFixed(2)}deg) rotateY(${(s.cx * 8).toFixed(2)}deg)`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ---------- 01 Select: a bungee chain of springs ---------- */
(() => {
  const stage = document.querySelector('[data-stage="select"]');
  const wrap = stage.querySelector('[data-select]');
  const trigger = stage.querySelector('[data-select-trigger]');
  const valueEl = stage.querySelector('[data-select-value]');
  const options = [...stage.querySelectorAll('.chain-option')];
  const gap = 48;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const links = options.map((o) => ({ o, x: 0, vx: 0, y: 0, vy: 0, tw: 0, vtw: 0 }));
  let open = false;
  let changedAt = 0;
  let rootX = 0;
  let rootTarget = 0;
  let hovering = false;
  let last = performance.now();
  let bob = 0;
  let vbob = 0;

  // Springs: soft and bouncy on the way down, stiff on the way up
  const DROP = { k: 220, c: 16 };
  const LIFT = { k: 620, c: 32 };
  const SWING = { k: 110, c: 8 };
  const TWIST = { k: 70, c: 5 };

  function frame(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    const since = (now - changedAt) / 1000;

    if (!hovering) rootTarget = open ? Math.sin(now / 1500) * 7 : 0;
    rootX += (rootTarget - rootX) * (1 - Math.exp(-dt * 7));

    // The trigger takes the weight: it dips when the chain drops and when it snaps back in
    vbob += (-300 * bob - 14 * vbob) * dt;
    bob += vbob * dt;
    trigger.style.transform = reduced ? '' : `translateY(${bob.toFixed(2)}px) rotate(${(rootX * 0.03).toFixed(2)}deg)`;

    links.forEach((L, i) => {
      const prev = i === 0 ? { x: rootX, y: 0 } : links[i - 1];

      // Vertical: each link hangs from the one above, so the stretch cascades down
      const spring = open ? DROP : LIFT;
      const delay = open ? i * 0.04 : (links.length - 1 - i) * 0.012;
      const ty = open ? prev.y + gap : 0;
      if (reduced) { L.y = open ? (i + 1) * gap : 0; L.vy = 0; }
      else if (since > delay) {
        L.vy += (spring.k * (ty - L.y) - spring.c * L.vy) * dt;
        L.y += L.vy * dt;
      }

      // Horizontal: follow the link above, a little late
      if (reduced) L.x = prev.x;
      else {
        L.vx += (SWING.k * (prev.x - L.x) - SWING.c * L.vx) * dt;
        L.x += L.vx * dt;
      }

      // Twist: turns with sideways speed, plus a slow idle dangle
      const idle = open && !reduced ? Math.sin(now / 1100 + i * 0.8) * 7 : 0;
      const tTw = clamp(L.vx * 0.22, -38, 38) + idle;
      L.vtw += (TWIST.k * (tTw - L.tw) - TWIST.c * L.vtw) * dt;
      L.tw += L.vtw * dt;

      const tilt = clamp((Math.atan2(L.x - prev.x, Math.max(8, L.y - prev.y)) * 180) / Math.PI, -35, 35);
      const shown = clamp(L.y / gap, 0, 1);
      L.o.style.transform = `translate3d(${L.x.toFixed(2)}px, ${L.y.toFixed(2)}px, 0) rotateZ(${(-tilt).toFixed(2)}deg) rotateY(${L.tw.toFixed(2)}deg) scale(${(0.7 + shown * 0.3).toFixed(3)})`;
      L.o.style.opacity = shown.toFixed(3);
    });

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // The chain leans toward the pointer and whips when it moves
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    hovering = true;
    const r = wrap.getBoundingClientRect();
    rootTarget = clamp((e.clientX - (r.left + r.width / 2)) * 0.22, -70, 70);
    if (open) links[0].vx += clamp(e.movementX, -30, 30) * 3;
  });
  stage.addEventListener('pointerleave', () => { hovering = false; });

  function setOpen(next, focusFirst = false) {
    if (open === next) return;
    open = next;
    changedAt = performance.now();
    wrap.classList.toggle('open', next);
    trigger.setAttribute('aria-expanded', String(next));
    vbob += next ? 70 : 110;
    // A small kick so it never moves perfectly straight
    links.forEach((L, i) => { L.vx += rand(-1, 1) * (next ? 60 : 30) * (i + 1) * 0.3; });
    if (next && focusFirst) setTimeout(() => (options.find((o) => o.getAttribute('aria-selected') === 'true') || options[0]).focus(), 120);
  }

  function choose(o) {
    valueEl.textContent = o.textContent.trim();
    options.forEach((x) => x.setAttribute('aria-selected', String(x === o)));
    setOpen(false);
    trigger.focus();
  }

  trigger.addEventListener('click', (e) => setOpen(!open, e.detail === 0));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true, true); }
  });
  options.forEach((o, i) => {
    o.addEventListener('click', () => choose(o));
    o.addEventListener('focus', () => { links[i].vx += 90; });
    o.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); options[Math.min(i + 1, options.length - 1)].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); options[Math.max(i - 1, 0)].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(o); }
      else if (e.key === 'Escape') { setOpen(false); trigger.focus(); }
      else if (e.key === 'Tab') setOpen(false);
    });
  });
  document.addEventListener('click', (e) => {
    if (open && !wrap.contains(e.target)) setOpen(false);
  });
})();

/* ---------- 02 Button: a key that shatters in 3D ---------- */
(() => {
  const stage = document.querySelector('[data-stage="button"]');
  const btn = stage.querySelector('[data-shatter]');
  const depth = 10;
  let broken = false;

  function shatter() {
    const sr = stage.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const W = btn.offsetWidth;
    const H = btn.offsetHeight + depth;
    const left = br.left + br.width / 2 - sr.left - W / 2;
    const top = br.top - sr.top;
    const c = [W * rand(0.4, 0.6), H * rand(0.35, 0.6)];
    const rim = [
      [0, 0], [W * rand(0.22, 0.42), 0], [W, 0], [W, H * rand(0.35, 0.7)],
      [W, H], [W * rand(0.5, 0.78), H], [0, H], [0, H * rand(0.3, 0.6)],
    ];
    const shards = [[1, 2, 3], [3, 4, 5], [5, 6, 7], [7, 0, 1]].map((idx) => [c, ...idx.map((i) => rim[i])]);

    btn.classList.remove('pressed');
    shards.forEach((pts) => {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const bx = Math.min(...xs), by = Math.min(...ys);
      const bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
      const shard = document.createElement('div');
      shard.className = 'shard';
      shard.setAttribute('aria-hidden', 'true');
      shard.style.width = `${bw}px`;
      shard.style.height = `${bh}px`;
      const inner = btn.cloneNode(true);
      inner.removeAttribute('data-shatter');
      inner.tabIndex = -1;
      inner.style.left = `${-bx}px`;
      inner.style.top = `${-by}px`;
      inner.style.width = `${W}px`;
      inner.style.height = `${H - depth}px`;
      // The key's side is part of the shard, so each piece keeps its thickness
      inner.style.boxShadow = `0 ${depth}px 0 var(--accent-deep)`;
      inner.style.clipPath = `polygon(${pts.map((p) => `${p[0]}px ${p[1]}px`).join(', ')})`;
      shard.appendChild(inner);
      stage.appendChild(shard);
      const mx = bx + bw / 2 - c[0];
      const my = by + bh / 2 - c[1];
      addBody(shard, stage, {
        x: left + bx,
        y: top + by,
        vx: mx * 6 + rand(-60, 60),
        vy: -rand(380, 620) + my * 5,
        vr: rand(-260, 260),
        vrx: rand(-520, 520),
        vry: rand(-520, 520),
        onRestore: (b) => b.el.remove(),
      });
    });
    btn.style.visibility = 'hidden';
  }

  function crack() {
    const sr = stage.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'crack');
    svg.setAttribute('width', br.width);
    svg.setAttribute('height', br.height);
    svg.style.left = `${br.left - sr.left}px`;
    svg.style.top = `${br.top - sr.top}px`;
    const cx = br.width * 0.5, cy = br.height * 0.5;
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M${cx} ${cy} L${br.width * 0.3} 0 M${cx} ${cy} L${br.width} ${br.height * 0.55} M${cx} ${cy} L${br.width * 0.65} ${br.height} M${cx} ${cy} L0 ${br.height * 0.45}`);
    svg.appendChild(path);
    stage.appendChild(svg);
    return svg;
  }

  btn.addEventListener('click', () => {
    if (broken) return;
    broken = true;
    btn.classList.add('pressed');
    setTimeout(() => {
      const lines = crack();
      setTimeout(() => { lines.remove(); shatter(); }, reduced ? 0 : 170);
    }, reduced ? 0 : 90);
  });

  stage.__afterRepair = () => {
    btn.style.visibility = '';
    broken = false;
  };
})();

/* ---------- 03 Switch: the sphere overshoots the track ---------- */
(() => {
  const stage = document.querySelector('[data-stage="switch"]');
  const sw = stage.querySelector('[data-switch]');
  const knob = stage.querySelector('[data-knob]');

  sw.addEventListener('click', () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    if (!on || knob.parentNode !== sw) return;
    setTimeout(() => {
      if (sw.getAttribute('aria-checked') !== 'true' || knob.parentNode !== sw) return;
      detach(knob, stage, {
        round: true,
        vx: 360,
        vy: -60,
        onRestore: (b) => sw.appendChild(b.el),
      });
    }, reduced ? 0 : 190);
  });
})();

/* ---------- 04 Text field: a solid you can turn ---------- */
(() => {
  const stage = document.querySelector('[data-stage="field"]');
  const box = stage.querySelector('[data-box]');
  const input = stage.querySelector('[data-field-input]');
  const backText = stage.querySelector('[data-back-text]');
  const rest = { x: -16, y: -24 };
  let rx = rest.x, ry = rest.y;
  let vrx = 0, vry = 0;
  let down = null;
  let dragging = false;
  let idleSince = performance.now();
  let returning = false;

  input.addEventListener('input', () => {
    backText.textContent = input.value || input.placeholder;
  });

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, id: e.pointerId };
    dragging = false;
  });

  stage.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
      dragging = true;
      returning = false;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
      input.blur();
      window.getSelection()?.removeAllRanges();
      markDirty(stage);
    }
    if (!dragging) return;
    e.preventDefault();
    vry = (e.clientX - down.lx) * 0.5;
    vrx = -(e.clientY - down.ly) * 0.5;
    ry += vry;
    rx += vrx;
    down.lx = e.clientX;
    down.ly = e.clientY;
  });

  const release = () => {
    down = null;
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('dragging');
    idleSince = performance.now();
    if (reduced) { vrx = 0; vry = 0; }
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  // A double click puts it back facing you
  stage.addEventListener('dblclick', (e) => {
    if (e.target !== input) repair(stage);
  });

  function frame(now) {
    if (!dragging) {
      rx += vrx;
      ry += vry;
      vrx *= 0.95;
      vry *= 0.95;
      const slow = Math.abs(vrx) + Math.abs(vry) < 0.1;
      if (returning || (slow && now - idleSince > 2500)) {
        const k = returning ? 0.1 : 0.03;
        const tx = rest.x + nearest(rx - rest.x, 360);
        const ty = rest.y + nearest(ry - rest.y, 360);
        rx += (tx - rx) * k;
        ry += (ty - ry) * k;
        if (Math.abs(tx - rx) + Math.abs(ty - ry) < 0.2) returning = false;
      }
    }
    box.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  stage.__afterRepair = () => {
    vrx = 0;
    vry = 0;
    returning = true;
  };
})();

/* ---------- 05 Slider: the track sags, and snaps if shaken ---------- */
(() => {
  const stage = document.querySelector('[data-stage="slider"]');
  const rope = stage.querySelector('[data-rope]');
  const input = stage.querySelector('[data-rope-input]');
  const handle = stage.querySelector('[data-rope-handle]');
  const paths = ['a', 'b', 'sa', 'sb'].map((k) => stage.querySelector(`[data-rope-${k}]`));
  const out = stage.querySelector('[data-rope-out]');
  const y0 = 30;
  const radius = 16;
  let sag = 0;
  let vel = 0;
  let energy = 0;
  let last = Number(input.value);
  let snapped = null;

  function draw(a, b) {
    paths[0].setAttribute('d', a);
    paths[1].setAttribute('d', b);
    paths[2].setAttribute('d', a);
    paths[3].setAttribute('d', b);
  }

  function frame(now) {
    const W = rope.clientWidth;
    const x = (input.value / 100) * W;
    if (!snapped) {
      const target = 115 * Math.sin((Math.PI * input.value) / 100);
      vel = (vel + (target - sag) * 0.09) * 0.86;
      sag += reduced ? target - sag : vel;
      const hy = y0 + sag;
      draw(
        `M0 ${y0} C ${x * 0.45} ${y0} ${x * 0.7} ${hy} ${x} ${hy}`,
        `M${x} ${hy} C ${x + (W - x) * 0.3} ${hy} ${x + (W - x) * 0.55} ${y0} ${W} ${y0}`,
      );
      if (handle.parentNode === rope) handle.style.transform = `translate(${x - radius}px, ${hy - radius}px)`;
      energy *= 0.965;
    } else {
      const el = now - snapped.t0;
      const t = reduced ? 1 : Math.min(1, el / 900);
      const e = 1 - Math.pow(1 - t, 3);
      const sway = reduced ? 0 : Math.sin(el / 160) * 14 * Math.exp(-el / 700);
      const lx = lerp(snapped.x, 6 + sway, e);
      const ly = lerp(snapped.y, y0 + Math.min(snapped.x * 0.9, 400), e);
      const rx = lerp(snapped.x, W - 6 - sway, e);
      const ry = lerp(snapped.y, y0 + Math.min((W - snapped.x) * 0.9, 400), e);
      draw(
        `M0 ${y0} Q ${lx * 0.5} ${(y0 + ly) / 2 + 12} ${lx} ${ly}`,
        `M${W} ${y0} Q ${W - (W - rx) * 0.5} ${(y0 + ry) / 2 + 12} ${rx} ${ry}`,
      );
    }
    requestAnimationFrame(frame);
  }

  function snap() {
    snapped = { t0: performance.now(), x: (input.value / 100) * rope.clientWidth, y: y0 + sag };
    input.disabled = true;
    detach(handle, stage, {
      round: true,
      vx: rand(-100, 100),
      vy: vel * 40,
      onRestore: (b) => rope.insertBefore(b.el, input),
    });
  }

  input.addEventListener('input', () => {
    const v = Number(input.value);
    energy += Math.abs(v - last);
    last = v;
    out.textContent = `${v} kg`;
    if (!snapped && energy > 240) snap();
  });

  stage.__afterRepair = () => {
    if (!snapped) return;
    snapped = null;
    input.disabled = false;
    energy = 0;
    vel = 0;
  };

  requestAnimationFrame(frame);
})();

/* ---------- 06 Checkbox: the mark keeps going ---------- */
(() => {
  const stage = document.querySelector('[data-stage="checkbox"]');
  const input = stage.querySelector('[data-vine-input]');
  const svg = stage.querySelector('[data-vine-svg]');
  const lines = [stage.querySelector('[data-vine-path]'), stage.querySelector('[data-vine-shadow]')];
  let anims = [];

  function vine() {
    const W = stage.clientWidth, H = stage.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const x = input.offsetLeft + input.parentNode.offsetLeft;
    const y = input.offsetTop + input.parentNode.offsetTop;
    const s = input.offsetWidth;
    const pts = [[x + s * 0.2, y + s * 0.52], [x + s * 0.42, y + s * 0.74], [x + s * 0.8, y + s * 0.24]];
    let ang = -0.9;
    let p = pts[2];
    for (let i = 0; i < 11; i++) {
      ang += rand(-1.1, 1.1);
      const len = rand(60, 130);
      let nx = p[0] + Math.cos(ang) * len;
      let ny = p[1] + Math.sin(ang) * len;
      if (nx < 24 || nx > W - 24) { ang = Math.PI - ang; nx = Math.min(W - 24, Math.max(24, nx)); }
      if (ny < 24 || ny > H - 24) { ang = -ang; ny = Math.min(H - 24, Math.max(24, ny)); }
      p = [nx, ny];
      pts.push(p);
    }
    // The tick itself is two straight strokes, then a Catmull-Rom curve carries on from its tip
    let d = `M${pts[0][0]} ${pts[0][1]} L${pts[1][0]} ${pts[1][1]} L${pts[2][0]} ${pts[2][1]}`;
    for (let i = 2; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  function animate(from, to, duration, easing) {
    anims.forEach((a) => a.cancel());
    anims = lines.map((l) => l.animate(
      [{ strokeDashoffset: from }, { strokeDashoffset: to }],
      { duration: reduced ? 0 : duration, easing, fill: 'forwards' },
    ));
  }

  input.addEventListener('change', () => {
    if (input.checked) {
      const d = vine();
      lines.forEach((l) => l.setAttribute('d', d));
      const L = lines[0].getTotalLength();
      lines.forEach((l) => { l.style.strokeDasharray = `${L}`; });
      animate(L, 0, 3600, 'cubic-bezier(.25,.7,.3,1)');
      markDirty(stage);
    } else {
      const L = lines[0].getTotalLength();
      animate(0, L, 700, 'ease-in');
      markDirty(stage, false);
    }
  });

  stage.__afterRepair = () => {
    if (!input.checked) return;
    input.checked = false;
    input.dispatchEvent(new Event('change'));
  };
})();
