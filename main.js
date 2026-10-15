const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- Physics ----------
   Loose pieces are moved into their stage and simulated in stage coordinates.
   Each remembers where it came from, so the glue can put it back. */

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
  b.el.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.r}deg)`;
}

function step(b, dt) {
  const W = b.stage.clientWidth;
  const H = b.stage.clientHeight;
  b.vy += GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.r += b.vr * dt;

  if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx) * 0.5; }
  if (b.x > W - b.w) { b.x = W - b.w; b.vx = -Math.abs(b.vx) * 0.5; }

  const floor = H - b.h - heapHeight(b.stage, b.x + b.w * 0.2, b.w * 0.6);
  if (b.y < floor) { b.still = 0; return; }

  b.y = floor;
  if (b.vy > 140) {
    b.vy = -b.vy * (b.round ? 0.42 : 0.28);
    b.vx *= 0.85;
    b.vr *= 0.6;
  } else {
    b.vy = 0;
    b.vx *= b.round ? 0.985 : 0.8;
  }

  const flat = Math.round(b.r / 180) * 180;
  if (b.round) {
    b.vr = (b.vx / (b.w / 2)) * (180 / Math.PI);
  } else {
    b.r += (flat - b.r) * 0.25;
    b.vr *= 0.6;
  }

  const resting = Math.abs(b.vx) < 6 && b.vy === 0 && (b.round || Math.abs(b.r - flat) < 1);
  if (resting && ++b.still > 8) {
    b.settled = true;
    if (!b.round) b.r = flat;
    heapAdd(b.stage, b.x + b.w * 0.15, b.w * 0.7, (H - b.y) * 0.96);
  }
}

function tick(now) {
  const dt = Math.min(0.032, (now - lastTick) / 1000);
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

function addBody(el, stage, o) {
  el.classList.add('piece');
  const b = {
    el, stage,
    x: o.x, y: o.y, r: o.rotation || 0,
    ox: o.x, oy: o.y, or: o.rotation || 0,
    vx: o.vx || 0, vy: o.vy || 0, vr: o.vr || 0,
    w: el.offsetWidth, h: el.offsetHeight,
    round: !!o.round,
    onRestore: o.onRestore,
    settled: false, still: 0, tween: false,
  };
  bodies.add(b);
  render(b);
  noteBreak();
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
  const sx = b.x, sy = b.y, sr = b.r;
  const tr = b.or + Math.round((sr - b.or) / 360) * 360;
  const dur = reduced ? 0 : rand(650, 850);
  const t0 = performance.now();
  const frame = (now) => {
    const t = dur ? Math.min(1, (now - t0) / dur) : 1;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    b.x = lerp(sx, b.ox, e);
    b.y = lerp(sy, b.oy, e) - Math.sin(Math.PI * t) * 60;
    b.r = lerp(sr, tr, e);
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
    if (!bodies.size) glue.classList.remove('needed');
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

/* ---------- Glue ---------- */

const glue = document.querySelector('[data-glue]');
const hint = document.querySelector('[data-glue-hint]');
let armed = false;
let hinted = false;
let glueUsed = false;

function noteBreak() {
  glue.classList.remove('needed');
  void glue.offsetWidth;
  glue.classList.add('needed');
  if (!hinted && !glueUsed) {
    hinted = true;
    setTimeout(() => hint.classList.add('show'), 600);
  }
}

function arm(on) {
  armed = on;
  document.body.classList.toggle('glue-armed', on);
  glue.setAttribute('aria-pressed', String(on));
  if (on) {
    glueUsed = true;
    hint.classList.remove('show');
  }
}

function dropGlue(x, y) {
  const d = document.createElement('div');
  d.className = 'glue-drop';
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1700);
}

glue.addEventListener('click', (e) => {
  // From the keyboard there is nothing to aim with, so it repairs everything
  if (e.detail === 0) {
    glueUsed = true;
    hint.classList.remove('show');
    document.querySelectorAll('[data-stage]').forEach(repair);
    return;
  }
  arm(!armed);
});

document.addEventListener('mousedown', (e) => {
  if (armed && !glue.contains(e.target)) e.preventDefault();
}, true);

document.addEventListener('click', (e) => {
  if (!armed || glue.contains(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  dropGlue(e.clientX, e.clientY);
  const stage = e.target.closest('[data-stage]');
  if (stage) repair(stage);
  arm(false);
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && armed) arm(false);
});

/* ---------- 01 Select: opens along an arc, labels fall out ---------- */
(() => {
  const stage = document.querySelector('[data-stage="select"]');
  const wrap = stage.querySelector('[data-arc]');
  const trigger = stage.querySelector('[data-arc-trigger]');
  const valueEl = stage.querySelector('[data-arc-value]');
  const options = [...stage.querySelectorAll('.arc-option')];
  let open = false;
  let looseTimer;

  const sweep = 70;
  const tilt = 0.35;
  const cy = trigger.offsetHeight + 10;
  wrap.style.setProperty('--y0', `${cy}px`);

  // The arc's radius follows the space available, so it fits a phone too
  function layout() {
    const room = stage.clientWidth - wrap.offsetLeft - 200;
    const R = Math.max(190, Math.min(300, room / (1 - Math.cos((sweep * Math.PI) / 180))));
    options.forEach((o, i) => {
      const deg = (i * sweep) / (options.length - 1);
      const th = ((180 - deg) * Math.PI) / 180;
      o.style.setProperty('--x', `${R + R * Math.cos(th)}px`);
      o.style.setProperty('--y', `${cy + R * Math.sin(th)}px`);
      o.style.setProperty('--rot', `${deg * tilt}deg`);
      o.style.setProperty('--i', i);
      o.__rot = deg * tilt;
    });
  }
  layout();
  window.addEventListener('resize', layout);

  function setOpen(next, focusFirst = false) {
    open = next;
    wrap.classList.toggle('open', next);
    trigger.setAttribute('aria-expanded', String(next));
    clearTimeout(looseTimer);
    if (next) {
      looseTimer = setTimeout(loosen, 1600);
      if (focusFirst) setTimeout(() => (options.find((o) => o.getAttribute('aria-selected') === 'true') || options[0]).focus(), 50);
    }
  }

  function loosen() {
    if (!open) return;
    const attached = options.filter((o) => o.querySelector('.opt-label'));
    if (attached.length) {
      const o = pick(attached);
      const label = o.querySelector('.opt-label');
      label.classList.add('loose');
      setTimeout(() => {
        label.classList.remove('loose');
        if (!open || label.parentNode !== o) return;
        detach(label, stage, {
          rotation: o.__rot,
          vx: rand(-30, 90),
          vy: -20,
          vr: rand(-90, 90),
          onRestore: (b) => o.appendChild(b.el),
        });
      }, reduced ? 0 : 420);
    }
    looseTimer = setTimeout(loosen, rand(1300, 2200));
  }

  function choose(o) {
    const label = o.querySelector('.opt-label');
    valueEl.textContent = label ? label.textContent : ' ';
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

  stage.__beforeRepair = () => { if (!open) setOpen(true); };
})();

/* ---------- 02 Button: shatters on press ---------- */
(() => {
  const stage = document.querySelector('[data-stage="button"]');
  const btn = stage.querySelector('[data-shatter]');
  let broken = false;

  function shatter() {
    const sr = stage.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const W = btn.offsetWidth;
    const H = btn.offsetHeight;
    const left = br.left + br.width / 2 - sr.left - W / 2;
    const top = br.top + br.height / 2 - sr.top - H / 2;
    const c = [W * rand(0.4, 0.6), H * rand(0.35, 0.65)];
    const rim = [
      [0, 0], [W * rand(0.22, 0.42), 0], [W, 0], [W, H * rand(0.35, 0.7)],
      [W, H], [W * rand(0.5, 0.78), H], [0, H], [0, H * rand(0.3, 0.6)],
    ];
    const shards = [[1, 2, 3], [3, 4, 5], [5, 6, 7], [7, 0, 1]].map((idx) => [c, ...idx.map((i) => rim[i])]);

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
      inner.style.height = `${H}px`;
      inner.style.clipPath = `polygon(${pts.map((p) => `${p[0]}px ${p[1]}px`).join(', ')})`;
      shard.appendChild(inner);
      stage.appendChild(shard);
      const mx = bx + bw / 2 - c[0];
      const my = by + bh / 2 - c[1];
      addBody(shard, stage, {
        x: left + bx,
        y: top + by,
        vx: mx * 5 + rand(-40, 40),
        vy: -rand(200, 380) + my * 4,
        vr: rand(-260, 260),
        onRestore: (b) => b.el.remove(),
      });
    });
    btn.style.visibility = 'hidden';
  }

  function crack() {
    const sr = stage.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'crack');
    svg.setAttribute('width', br.width);
    svg.setAttribute('height', br.height);
    svg.style.left = `${br.left - sr.left}px`;
    svg.style.top = `${br.top - sr.top}px`;
    const cx = br.width * 0.5, cy = br.height * 0.5;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${cx} ${cy} L${br.width * 0.3} 0 M${cx} ${cy} L${br.width} ${br.height * 0.55} M${cx} ${cy} L${br.width * 0.65} ${br.height} M${cx} ${cy} L0 ${br.height * 0.45}`);
    svg.appendChild(path);
    stage.appendChild(svg);
    return svg;
  }

  btn.addEventListener('click', () => {
    if (broken) return;
    broken = true;
    const lines = crack();
    setTimeout(() => { lines.remove(); shatter(); }, reduced ? 0 : 160);
  });

  stage.__afterRepair = () => {
    btn.style.visibility = '';
    broken = false;
  };
})();

/* ---------- 03 Switch: the knob overshoots the track ---------- */
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
        vx: 340,
        vy: -50,
        onRestore: (b) => sw.appendChild(b.el),
      });
    }, reduced ? 0 : 190);
  });
})();

/* ---------- 04 Text field: letters fall out ---------- */
(() => {
  const stage = document.querySelector('[data-stage="field"]');
  const input = stage.querySelector('[data-leaky]');
  const mirror = stage.querySelector('[data-mirror]');
  const lost = [];

  function renderMirror() {
    mirror.textContent = '';
    for (const ch of input.value.split('')) {
      const s = document.createElement('span');
      s.className = 'ch';
      s.textContent = ch;
      mirror.appendChild(s);
    }
    mirror.scrollLeft = input.scrollLeft;
  }

  function loosen() {
    const chars = input.value.split('');
    const candidates = chars.map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0);
    if (candidates.length < 2 || Math.random() < 0.35) return;
    const idx = pick(candidates);
    const span = mirror.children[idx];
    span.classList.add('loose');
    setTimeout(() => {
      if (mirror.children[idx] !== span) return;
      span.classList.remove('loose');
      const ch = span.textContent;
      detach(span, stage, {
        vx: rand(-60, 60),
        vy: -30,
        vr: rand(-200, 200),
        onRestore: (b) => b.el.remove(),
      });
      const caret = input.selectionStart;
      const v = input.value;
      input.value = v.slice(0, idx) + v.slice(idx + 1);
      lost.push({ ch, idx });
      renderMirror();
      if (document.activeElement === input && caret != null) {
        const pos = caret > idx ? caret - 1 : caret;
        input.setSelectionRange(pos, pos);
      }
    }, reduced ? 0 : 450);
  }

  input.addEventListener('input', renderMirror);
  input.addEventListener('scroll', () => { mirror.scrollLeft = input.scrollLeft; });
  setInterval(loosen, 1500);

  // Letters go back in the reverse order they fell out
  stage.__afterRepair = () => {
    let v = input.value;
    while (lost.length) {
      const { ch, idx } = lost.pop();
      const i = Math.min(idx, v.length);
      v = v.slice(0, i) + ch + v.slice(i);
    }
    input.value = v;
    renderMirror();
  };
})();

/* ---------- 05 Slider: the track sags, and snaps if shaken ---------- */
(() => {
  const stage = document.querySelector('[data-stage="slider"]');
  const rope = stage.querySelector('[data-rope]');
  const input = stage.querySelector('[data-rope-input]');
  const handle = stage.querySelector('[data-rope-handle]');
  const pathA = stage.querySelector('[data-rope-a]');
  const pathB = stage.querySelector('[data-rope-b]');
  const out = stage.querySelector('[data-rope-out]');
  const y0 = 30;
  const radius = 14;
  let sag = 0;
  let vel = 0;
  let energy = 0;
  let last = Number(input.value);
  let snapped = null;

  function frame(now) {
    const W = rope.clientWidth;
    const x = (input.value / 100) * W;
    if (!snapped) {
      const target = 110 * Math.sin((Math.PI * input.value) / 100);
      vel = (vel + (target - sag) * 0.09) * 0.86;
      sag += reduced ? target - sag : vel;
      const hy = y0 + sag;
      pathA.setAttribute('d', `M0 ${y0} C ${x * 0.45} ${y0} ${x * 0.7} ${hy} ${x} ${hy}`);
      pathB.setAttribute('d', `M${x} ${hy} C ${x + (W - x) * 0.3} ${hy} ${x + (W - x) * 0.55} ${y0} ${W} ${y0}`);
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
      pathA.setAttribute('d', `M0 ${y0} Q ${lx * 0.5} ${(y0 + ly) / 2 + 12} ${lx} ${ly}`);
      pathB.setAttribute('d', `M${W} ${y0} Q ${W - (W - rx) * 0.5} ${(y0 + ry) / 2 + 12} ${rx} ${ry}`);
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
  const path = stage.querySelector('[data-vine-path]');
  let anim;

  function vine() {
    const sr = stage.getBoundingClientRect();
    const br = input.getBoundingClientRect();
    const W = sr.width, H = sr.height;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const x = br.left - sr.left, y = br.top - sr.top, s = br.width;
    const pts = [[x + s * 0.2, y + s * 0.52], [x + s * 0.42, y + s * 0.74], [x + s * 0.8, y + s * 0.24]];
    let ang = -0.9;
    let p = pts[2];
    for (let i = 0; i < 10; i++) {
      ang += rand(-1.1, 1.1);
      const len = rand(60, 120);
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

  input.addEventListener('change', () => {
    anim?.cancel();
    if (input.checked) {
      path.setAttribute('d', vine());
      const L = path.getTotalLength();
      path.style.strokeDasharray = `${L}`;
      path.style.strokeDashoffset = '0';
      anim = path.animate(
        [{ strokeDashoffset: L }, { strokeDashoffset: 0 }],
        { duration: reduced ? 0 : 3400, easing: 'cubic-bezier(.25,.7,.3,1)', fill: 'forwards' },
      );
    } else {
      const L = path.getTotalLength();
      path.style.strokeDashoffset = `${L}`;
      anim = path.animate(
        [{ strokeDashoffset: 0 }, { strokeDashoffset: L }],
        { duration: reduced ? 0 : 700, easing: 'ease-in', fill: 'forwards' },
      );
    }
  });
})();
