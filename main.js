const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const W = 1080;
const H = 610;
const _ = null;

/* ---------- Stations: old school meets disco-tech ----------
   hat: c closed, o open · stab: a chord on that step */

const Em7 = [64, 67, 71, 74];
const Am7 = [69, 72, 76, 79];
const Dm9 = [62, 65, 69, 72, 76];

const STATIONS = [
  {
    f: 904, name: 'Disco tech', bpm: 118, swing: 0,
    kick:  'x...x...x...x...',
    snare: '....x.......x...',
    clap: true,
    hat:   'c.o.c.o.c.o.c.oc',
    bass: [40, _, 52, _, 40, _, 52, _, 43, _, 55, _, 45, _, 57, _],
    stab: { 6: Em7, 14: Am7 },
  },
  {
    f: 968, name: 'Electro funk', bpm: 110, swing: 0,
    kick:  'x.....x...x.....',
    snare: '....x.......x...',
    clap: true,
    hat:   'cccccccccccccccc',
    cow:   '..x...x.x.....x.',
    bass: [28, _, 40, _, _, 28, 40, _, 31, _, 43, _, 26, _, 38, _],
    stab: { 0: Em7 },
  },
  {
    f: 1015, name: 'Boom bap', bpm: 92, swing: 0.1,
    kick:  'x......x.x......',
    snare: '....x.......x...',
    hat:   'c.c.c.c.c.c.c.cc',
    bass: [33, _, _, _, _, _, _, 36, _, 33, _, _, _, _, 31, _],
    stab: { 0: Dm9, 10: Dm9 },
    soft: true,
  },
  {
    f: 1055, name: 'Breakbeat', bpm: 98, swing: 0.06,
    kick:  'x.x.......xx....x.x.......x..x..',
    snare: '....x..g....x.......x..g......x.',
    hat:   'c.c.c.c.c.c.c.c.c.c.c.c.c.c.c.o.',
    bass: [28, _, _, _, _, _, _, _, _, _, 31, _, _, _, _, _, 28, _, _, _, _, _, _, _, _, _, 26, _, _, 26, _, _],
  },
];

const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/* ---------- Audio graph ----------
   sources → drive → filter → 10-band EQ → dry + echo + reverb → bass shelf → glue compressor → volume */

let ctx = null;
let master, shelf, analyser, musicBus, padBus, staticGain, noiseBuf;
let driveIn, shaper, driveOut, filter, delay, delayFb, echoSend, reverbSend;
const eqFilters = [];
let freqData, timeData;

const fx = { filter: 0, echo: 0, reverb: 0.12, drive: 0.08, volume: 6 };

function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  padBus = ctx.createGain();
  staticGain = ctx.createGain();
  staticGain.gain.value = 0;

  driveIn = ctx.createGain();
  shaper = ctx.createWaveShaper();
  shaper.oversample = '2x';
  driveOut = ctx.createGain();
  filter = ctx.createBiquadFilter();

  let node = filter;
  EQ_BANDS.forEach((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    b.frequency.value = f;
    b.Q.value = 1.3;
    b.gain.value = Number($$('[data-geq] input')[i]?.value || 0);
    node.connect(b);
    node = b;
    eqFilters.push(b);
  });
  const post = node;

  const mix = ctx.createGain();
  post.connect(mix);

  // Echo: a tape-style delay, darker on every repeat
  echoSend = ctx.createGain();
  delay = ctx.createDelay(2);
  delayFb = ctx.createGain();
  const delayTone = ctx.createBiquadFilter();
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 2600;
  post.connect(echoSend).connect(delay);
  delay.connect(delayTone).connect(delayFb).connect(delay);
  delayTone.connect(mix);

  // Reverb: a convolver fed with a generated impulse
  reverbSend = ctx.createGain();
  const verb = ctx.createConvolver();
  verb.buffer = impulse(2.6, 2.4);
  post.connect(reverbSend).connect(verb).connect(mix);

  shelf = ctx.createBiquadFilter();
  shelf.type = 'lowshelf';
  shelf.frequency.value = 120;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  master = ctx.createGain();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  freqData = new Uint8Array(analyser.frequencyBinCount);
  timeData = new Float32Array(analyser.fftSize);

  [musicBus, padBus, staticGain].forEach((n) => n.connect(driveIn));
  driveIn.connect(shaper).connect(driveOut).connect(filter);
  mix.connect(shelf).connect(comp).connect(master).connect(analyser).connect(ctx.destination);

  // Radio static, always running, faded in between stations
  const hiss = ctx.createBufferSource();
  hiss.buffer = noiseBuf;
  hiss.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2200;
  band.Q.value = 0.6;
  hiss.connect(band).connect(staticGain);
  hiss.start();

  Object.keys(fx).forEach(applyFx);
  shelf.gain.value = bass ? 10 : 0;
  updateDelayTime();
}

function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function driveCurve(amount) {
  const k = amount * 40;
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function applyFx(name) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const v = fx[name];
  if (name === 'volume') master.gain.setTargetAtTime(Math.pow(v / 10, 2) * 0.95, now, 0.03);
  if (name === 'drive') {
    shaper.curve = driveCurve(v);
    driveIn.gain.setTargetAtTime(1 + v * 1.4, now, 0.03);
    driveOut.gain.setTargetAtTime(1 / (1 + v * 1.1), now, 0.03);
  }
  if (name === 'echo') {
    echoSend.gain.setTargetAtTime(v * 0.75, now, 0.03);
    delayFb.gain.setTargetAtTime(0.15 + v * 0.6, now, 0.03);
  }
  if (name === 'reverb') reverbSend.gain.setTargetAtTime(v * 1.3, now, 0.03);
  if (name === 'filter') {
    // DJ filter: left of centre closes a low-pass, right of centre opens a high-pass
    if (Math.abs(v) < 0.03) {
      filter.type = 'lowpass';
      filter.frequency.setTargetAtTime(20000, now, 0.02);
      filter.Q.value = 0.7;
    } else if (v < 0) {
      filter.type = 'lowpass';
      filter.frequency.setTargetAtTime(20000 * Math.pow(0.004, -v), now, 0.02);
      filter.Q.value = 7;
    } else {
      filter.type = 'highpass';
      filter.frequency.setTargetAtTime(20 * Math.pow(250, v), now, 0.02);
      filter.Q.value = 7;
    }
  }
}

function updateDelayTime() {
  if (delay) delay.delayTime.setTargetAtTime((60 / station.bpm) * 0.75, ctx.currentTime, 0.1);
}

/* ---------- Instruments ---------- */

function env(g, t, peak, decay, attack = 0.002) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

function noise(t, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur);
  return src;
}

function kick(t, p, v, out) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(160 * p, t);
  osc.frequency.exponentialRampToValueAtTime(45 * p, t + 0.12);
  env(g, t, 1.2 * v, 0.55);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.6);
  // A short click so it cuts through
  const c = noise(t, 0.02);
  const cg = ctx.createGain();
  env(cg, t, 0.12 * v, 0.012);
  c.connect(cg).connect(out);
}

function snare(t, p, v, out) {
  const n = noise(t, 0.3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1900;
  bp.Q.value = 0.6;
  const g = ctx.createGain();
  env(g, t, 0.55 * v, 0.2);
  n.connect(bp).connect(g).connect(out);
  const tone = ctx.createOscillator();
  tone.type = 'triangle';
  tone.frequency.setValueAtTime(210 * p, t);
  tone.frequency.exponentialRampToValueAtTime(160 * p, t + 0.08);
  const tg = ctx.createGain();
  env(tg, t, 0.6 * v, 0.13);
  tone.connect(tg).connect(out);
  tone.start(t);
  tone.stop(t + 0.16);
}

function clap(t, v, out) {
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1400;
  bp.Q.value = 0.9;
  bp.connect(out);
  [0, 0.011, 0.023].forEach((o, i) => {
    const d = i === 2 ? 0.18 : 0.025;
    const n = noise(t + o, d + 0.02);
    const g = ctx.createGain();
    env(g, t + o, 0.75 * v, d);
    n.connect(g).connect(bp);
  });
}

function hat(t, v, open, out) {
  const n = noise(t, open ? 0.3 : 0.06);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  env(g, t, 0.18 * v, open ? 0.26 : 0.045);
  n.connect(hp).connect(g).connect(out);
}

function bassNote(t, f, dur, out) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = f;
  const sub = ctx.createOscillator();
  sub.frequency.value = f / 2;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 6;
  lp.frequency.setValueAtTime(800, t);
  lp.frequency.exponentialRampToValueAtTime(200, t + dur);
  const g = ctx.createGain();
  env(g, t, 0.26, dur, 0.01);
  osc.connect(lp);
  sub.connect(lp);
  lp.connect(g).connect(out);
  [osc, sub].forEach((o) => { o.start(t); o.stop(t + dur + 0.05); });
}

function stab(t, notes, soft, out) {
  // A short, bright chord: detuned saws through a closing low-pass
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  lp.frequency.setValueAtTime(soft ? 1400 : 3200, t);
  lp.frequency.exponentialRampToValueAtTime(soft ? 500 : 700, t + (soft ? 0.6 : 0.22));
  const g = ctx.createGain();
  env(g, t, soft ? 0.09 : 0.11, soft ? 0.7 : 0.26, 0.004);
  lp.connect(g).connect(out);
  notes.forEach((n) => {
    [-6, 6].forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = soft ? 'triangle' : 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = cents;
      o.connect(lp);
      o.start(t);
      o.stop(t + (soft ? 0.75 : 0.3));
    });
  });
}

function cowbell(t, out) {
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800;
  bp.Q.value = 3;
  const g = ctx.createGain();
  env(g, t, 0.22, 0.28);
  bp.connect(g).connect(out);
  [540, 800].forEach((f) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(bp);
    o.start(t);
    o.stop(t + 0.3);
  });
}

/* ---------- Transport and sequencer ---------- */

let playing = false;
let stopping = false;
let mode = 'play';
let rate = 1;
let targetRate = 1;
let step = 0;
let nextTime = 0;
let recArmed = false;
let bass = false;
let clarity = 1;
let station = STATIONS[0];
const stepTimes = new Array(32).fill(0);
const overdub = { kick: new Array(32).fill(false), snare: new Array(32).fill(false) };
const visuals = [];

const hitAt = (pattern, s) => pattern[s] === 'x' || pattern[s] === 'g' || pattern[s] === 'o';
const length = () => station.kick.length;

function scheduleStep(s, t) {
  const base = 60 / station.bpm / 4;
  const swing = s % 2 ? (station.swing * base) / rate : 0;
  const tt = t + swing;
  const p = clamp(rate, 0.25, 2);
  stepTimes[s] = tt;

  if (hitAt(station.kick, s) || overdub.kick[s]) {
    kick(tt, p, 1, musicBus);
    visuals.push({ t: tt, kind: 'kick' });
  }
  if (hitAt(station.snare, s) || overdub.snare[s]) {
    const v = station.snare[s] === 'g' ? 0.3 : 1;
    if (station.clap && !overdub.snare[s]) clap(tt, v, musicBus);
    else snare(tt, p, v, musicBus);
    visuals.push({ t: tt, kind: 'snare', v });
  }
  const h = station.hat[s];
  if (h === 'c' || h === 'o') {
    hat(tt, h === 'o' ? 0.8 : s % 2 ? 0.45 : 0.75, h === 'o', musicBus);
    visuals.push({ t: tt, kind: 'hat' });
  }
  if (station.cow && station.cow[s] === 'x') cowbell(tt, musicBus);
  const chord = station.stab && station.stab[s];
  if (chord) {
    stab(tt, chord.map((n) => n + 12 * Math.log2(p)), station.soft, musicBus);
    visuals.push({ t: tt, kind: 'stab' });
  }
  const n = station.bass[s];
  if (n != null) {
    bassNote(tt, midi(n) * p, (base * 2.2) / rate, musicBus);
    visuals.push({ t: tt, kind: 'bass' });
  }
}

setInterval(() => {
  if (!ctx || !playing) return;
  rate += (targetRate - rate) * 0.3;
  while (nextTime < ctx.currentTime + 0.12) {
    const len = length();
    step %= len;
    scheduleStep(step, nextTime);
    nextTime += 60 / station.bpm / 4 / Math.max(rate, 0.08);
    step = mode === 'rew' ? (step + len - 1) % len : (step + 1) % len;
  }
}, 25);

function applyTuning() {
  if (!ctx) return;
  const now = ctx.currentTime;
  musicBus.gain.setTargetAtTime(playing && !stopping ? clarity : 0, now, 0.05);
  staticGain.gain.setTargetAtTime(playing && !stopping ? (1 - clarity) * 0.3 : 0, now, 0.05);
}

function start(nextMode) {
  ensureAudio();
  mode = nextMode;
  targetRate = mode === 'play' ? 1 : 1.75;
  if (!playing || stopping) {
    // A tape takes a moment to come up to speed
    playing = true;
    stopping = false;
    rate = 0.3;
    nextTime = ctx.currentTime + 0.05;
    step = mode === 'rew' ? length() - 1 : 0;
  }
  applyTuning();
  updateKeys();
  announce(mode === 'play' ? `Playing ${station.name}` : mode === 'ff' ? 'Fast forward' : 'Rewind');
}

function stop() {
  if (!playing) { eject(); return; }
  // Tape stop: the pitch sags as the motor winds down
  stopping = true;
  targetRate = 0.1;
  const now = ctx.currentTime;
  musicBus.gain.setTargetAtTime(0, now + 0.25, 0.1);
  staticGain.gain.setTargetAtTime(0, now, 0.05);
  updateKeys();
  announce('Stopped');
  setTimeout(() => {
    if (!stopping) return;
    playing = false;
    stopping = false;
    updateKeys();
  }, 600);
}

let ejectTimer;
let flash = null;
function eject() {
  const door = $('[data-door]');
  door.classList.add('ejected');
  overdub.kick.fill(false);
  overdub.snare.fill(false);
  flash = { text: 'EJECT · LOOP CLEARED', until: performance.now() + 1500 };
  announce('Ejected. Recorded hits cleared.');
  clearTimeout(ejectTimer);
  ejectTimer = setTimeout(() => door.classList.remove('ejected'), 1500);
}

/* ---------- Controls ---------- */

const keys = Object.fromEntries($$('[data-key]').map((k) => [k.dataset.key, k]));
const status = $('[data-status]');
const announce = (text) => { status.textContent = text; };

function updateKeys() {
  const active = playing && !stopping;
  keys.play.setAttribute('aria-pressed', String(active && mode === 'play'));
  keys.ff.setAttribute('aria-pressed', String(active && mode === 'ff'));
  keys.rew.setAttribute('aria-pressed', String(active && mode === 'rew'));
  keys.rec.setAttribute('aria-pressed', String(recArmed));
}

keys.play.addEventListener('click', () => start('play'));
keys.ff.addEventListener('click', () => start(mode === 'ff' && playing ? 'play' : 'ff'));
keys.rew.addEventListener('click', () => start(mode === 'rew' && playing ? 'play' : 'rew'));
keys.stop.addEventListener('click', stop);
keys.rec.addEventListener('click', () => {
  recArmed = !recArmed;
  updateKeys();
  announce(recArmed ? 'Record armed. Hit the woofers while playing.' : 'Record off');
});

// Seat every knob in a scale ring
$$('.knob').forEach((k) => {
  const seat = document.createElement('span');
  seat.className = `knob-seat${k.classList.contains('knob-big') ? ' big' : ''}`;
  k.replaceWith(seat);
  seat.appendChild(k);
});

// Rotary knobs: drag up and down, arrow keys, double-click to reset
let dragging = false;
function makeKnob(el, { min, max, value, step, format, onChange, detent }) {
  const range = max - min;
  let v = value;
  const set = (next, silent = false) => {
    v = clamp(next, min, max);
    if (detent != null && Math.abs(v - detent) < range * 0.025) v = detent;
    el.style.setProperty('--rot', `${-135 + ((v - min) / range) * 270}deg`);
    el.setAttribute('aria-valuemin', min);
    el.setAttribute('aria-valuemax', max);
    el.setAttribute('aria-valuenow', +v.toFixed(2));
    el.setAttribute('aria-valuetext', format(v));
    if (!silent) onChange(v);
  };
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, v };
    dragging = true;
  });
  el.addEventListener('pointermove', (e) => {
    if (drag) set(drag.v + ((drag.y - e.clientY) / 180) * range);
  });
  const end = () => { drag = null; dragging = false; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => set(value));
  el.addEventListener('keydown', (e) => {
    const moves = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: step * 5, PageDown: -step * 5 };
    if (e.key in moves) { e.preventDefault(); set(v + moves[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); set(min); }
    else if (e.key === 'End') { e.preventDefault(); set(max); }
  });
  set(value, true);
  return { set };
}

const pct = (v) => `${Math.round(v * 100)} percent`;
const knobs = {
  filter: makeKnob($('[data-knob="filter"]'), {
    min: -1, max: 1, value: 0, step: 0.05, detent: 0,
    format: (v) => (v === 0 ? 'Open' : v < 0 ? `Low-pass, ${Math.round(-v * 100)} percent` : `High-pass, ${Math.round(v * 100)} percent`),
    onChange: (v) => { fx.filter = v; applyFx('filter'); },
  }),
  echo: makeKnob($('[data-knob="echo"]'), {
    min: 0, max: 1, value: 0, step: 0.05, format: pct,
    onChange: (v) => { fx.echo = v; applyFx('echo'); },
  }),
  reverb: makeKnob($('[data-knob="reverb"]'), {
    min: 0, max: 1, value: 0.12, step: 0.05, format: pct,
    onChange: (v) => { fx.reverb = v; applyFx('reverb'); },
  }),
  drive: makeKnob($('[data-knob="drive"]'), {
    min: 0, max: 1, value: 0.08, step: 0.05, format: pct,
    onChange: (v) => { fx.drive = v; applyFx('drive'); },
  }),
  volume: makeKnob($('[data-knob="volume"]'), {
    min: 0, max: 10, value: 6, step: 0.5, format: (v) => `${Math.round(v)} of 10`,
    onChange: (v) => { fx.volume = v; applyFx('volume'); },
  }),
};

// Tuner: a range input on the dial and a knob next to it, kept in step
const tuning = $('[data-tuning]');
const tunerEl = $('[data-tuner]');
const lcdFreq = $('[data-lcd-freq]');
const lamp = $('[data-lamp]');

function onTune(fromKnob = false) {
  const v = Number(tuning.value);
  const nearest = STATIONS.reduce((a, b) => (Math.abs(b.f - v) < Math.abs(a.f - v) ? b : a));
  clarity = clamp(1 - (Math.abs(nearest.f - v) - 3) / 12, 0, 1);
  if (nearest !== station) {
    station = nearest;
    updateDelayTime();
  }
  tunerEl.style.setProperty('--tune', (v - 880) / 200);
  const mhz = (v / 10).toFixed(1);
  lcdFreq.textContent = `FM ${mhz}`;
  tuning.setAttribute('aria-valuetext', `${mhz} megahertz${clarity > 0.85 ? `, ${nearest.name}` : ''}`);
  lamp.classList.toggle('on', clarity > 0.85);
  if (!fromKnob) tuneKnob.set(v, true);
  applyTuning();
}
const tuneKnob = makeKnob($('[data-knob="tune"]'), {
  min: 880, max: 1080, value: 904, step: 1,
  format: (v) => `${(v / 10).toFixed(1)} megahertz`,
  onChange: (v) => { tuning.value = Math.round(v); onTune(true); },
});
tuning.addEventListener('input', () => onTune());
onTune();

// Graphic equalizer: ten range inputs standing on end
const geq = $('[data-geq]');
EQ_BANDS.forEach((f, i) => {
  const wrap = document.createElement('div');
  wrap.className = 'fader';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = -12;
  input.max = 12;
  input.step = 1;
  input.value = 0;
  const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
  input.setAttribute('aria-label', `Equalizer ${label}Hz`);
  input.setAttribute('aria-valuetext', '0 decibels');
  input.addEventListener('input', () => {
    input.setAttribute('aria-valuetext', `${input.value} decibels`);
    if (eqFilters[i]) eqFilters[i].gain.setTargetAtTime(Number(input.value), ctx.currentTime, 0.02);
  });
  input.addEventListener('dblclick', () => { input.value = 0; input.dispatchEvent(new Event('input')); });
  const span = document.createElement('span');
  span.textContent = label;
  span.setAttribute('aria-hidden', 'true');
  wrap.append(input, span);
  geq.appendChild(wrap);
});

// Bass boost
const bassSwitch = $('[data-bass]');
const boombox = $('[data-boombox]');
bassSwitch.addEventListener('click', () => {
  bass = !bass;
  bassSwitch.setAttribute('aria-checked', String(bass));
  boombox.classList.toggle('bass', bass);
  if (ctx) shelf.gain.setTargetAtTime(bass ? 10 : 0, ctx.currentTime, 0.05);
  speakers.forEach((s) => s.waves.push({ t0: performance.now(), s: 1.4 }));
});

// Tape counter and label
const digits = $$('[data-counter] .strip');
let counter = 0;
$('[data-counter-reset]').addEventListener('click', () => { counter = 0; });
const tapeLabel = $('[data-tape-label]');

/* ---------- Speakers: woofers are pads, grilles are checkboxes ---------- */

let shake = 0;
const speakers = $$('[data-speaker]').map((el) => {
  const grille = $('[data-grille]', el);
  const cone = $('[data-cone]', el);
  const dots = [];
  const c = 146;
  for (let y = -140; y <= 140; y += 10) {
    for (let x = -140; x <= 140; x += 10) {
      const r = Math.hypot(x, y);
      if (r < 80 || r > 138 || Math.abs(y) < 12) continue;
      const dot = document.createElement('input');
      dot.type = 'checkbox';
      dot.className = 'grille-dot';
      dot.tabIndex = -1;
      dot.setAttribute('aria-hidden', 'true');
      dot.style.left = `${c + x}px`;
      dot.style.top = `${c + y}px`;
      grille.appendChild(dot);
      dots.push({ el: dot, r, on: false });
    }
  }
  return { el, cone, dots, kind: el.dataset.speaker, pump: 0, waves: [] };
});

function fire(kind, v = 1) {
  const now = performance.now();
  if (kind === 'kick') {
    speakers[0].pump = Math.max(speakers[0].pump, v);
    speakers[0].waves.push({ t0: now, s: v });
    shake = Math.max(shake, v);
  } else if (kind === 'snare') {
    speakers[1].pump = Math.max(speakers[1].pump, v * 0.8);
    speakers[1].waves.push({ t0: now, s: v });
  } else if (kind === 'bass') {
    speakers.forEach((s) => { s.pump = Math.max(s.pump, 0.35); });
  } else if (kind === 'stab') {
    speakers.forEach((sp) => sp.waves.push({ t0: now, s: 0.6 }));
  } else if (kind === 'hat') {
    speakers.forEach((s) => { s.sparkle = now; });
  }
}

function hitPad(sp) {
  ensureAudio();
  const t = ctx.currentTime + 0.004;
  if (sp.kind === 'kick') kick(t, 1, 1, padBus);
  else snare(t, 1, 1, padBus);
  fire(sp.kind);
  // Recording: land the hit on the nearest step of the loop
  if (recArmed && playing && !stopping) {
    const len = length();
    let best = 0;
    for (let s = 1; s < len; s++) if (Math.abs(stepTimes[s] - t) < Math.abs(stepTimes[best] - t)) best = s;
    overdub[sp.kind][best] = true;
  }
}

speakers.forEach((sp) => {
  let fromPointer = false;
  sp.cone.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fromPointer = true;
    hitPad(sp);
  });
  sp.cone.addEventListener('click', () => {
    if (fromPointer) { fromPointer = false; return; }
    hitPad(sp);
  });
});

/* ---------- Scene: fit, parallax, chrome shine ---------- */

const stageEl = $('[data-stage]');
const scene = $('[data-scene]');
const chrome = $('[data-chrome]');

function fit() {
  const scale = Math.min(1, (stageEl.clientWidth - 16) / (W + 170));
  scene.style.transform = `scale(${scale})`;
  scene.style.top = `${104 * scale}px`;
  stageEl.style.height = `${(H + 104 + 160) * scale}px`;
}
fit();
window.addEventListener('resize', fit);

let tx = 0, ty = 0, cx = 0, cy = 0;
let lastPointer = 0;
window.addEventListener('pointermove', (e) => {
  if (dragging) return;
  tx = e.clientX / window.innerWidth - 0.5;
  ty = e.clientY / window.innerHeight - 0.5;
  lastPointer = performance.now();
});

/* ---------- Render loop ---------- */

const bars = Array.from({ length: 16 }, () => {
  const i = document.createElement('i');
  $('[data-spectrum]').appendChild(i);
  return i;
});
const vu = $('[data-vu]');
const lcdInfo = $('[data-lcd-info]');
const reels = $$('[data-reel]');
const hubs = reels.map((r) => $('.hub', r));
let vuAngle = -48;
let reelAngle = 0;
let lastFrame = performance.now();
let lastInfo = '';
let lastCount = -1;

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  // Parallax: drift on its own when nobody is pointing
  if (!reduced) {
    if (now - lastPointer > 5000) {
      tx = Math.sin(now / 3200) * 0.3;
      ty = Math.cos(now / 4100) * 0.2;
    }
    cx += (tx - cx) * 0.05;
    cy += (ty - cy) * 0.05;
  }
  shake *= Math.exp(-dt * 14);
  const lift = bass ? 5 : 2.5;
  boombox.style.transform = `translateY(${(shake * lift).toFixed(2)}px) rotateX(${(-12 - cy * 6).toFixed(2)}deg) rotateY(${(26 + cx * 12).toFixed(2)}deg)`;
  boombox.style.setProperty('--kx', (-(26 + cx * 12) / 7).toFixed(2));
  chrome.style.setProperty('--shine', `${(40 + cy * 40 + cx * 12).toFixed(1)}%`);

  // Fire beat visuals in time with the audio clock
  if (ctx) {
    visuals.sort((a, b) => a.t - b.t);
    while (visuals.length && visuals[0].t <= ctx.currentTime) {
      const v = visuals.shift();
      fire(v.kind, v.v ?? 1);
    }
  }

  // Speakers: cones pump, grille checkboxes light in rings
  for (const sp of speakers) {
    sp.pump *= Math.exp(-dt * 10);
    sp.cone.style.setProperty('--pump', (1 + sp.pump * (bass ? 0.13 : 0.07)).toFixed(3));
    sp.waves = sp.waves.filter((w) => now - w.t0 < 520);
    const sparkle = sp.sparkle && now - sp.sparkle < 60;
    for (const d of sp.dots) {
      let on = false;
      for (const w of sp.waves) {
        const r = 80 + ((now - w.t0) / 420) * 62 * Math.min(1.3, w.s);
        if (Math.abs(d.r - r) < 6) { on = true; break; }
      }
      if (!on && sparkle && Math.random() < 0.04) on = true;
      if (on !== d.on) { d.on = on; d.el.checked = on; }
    }
  }

  // Reels and counter
  if (playing) {
    const dir = mode === 'rew' ? -1 : 1;
    reelAngle += dt * 220 * rate * dir;
    counter = (counter + dt * 3.2 * rate * dir + 1000) % 1000;
  }
  const prog = counter / 1000;
  reels[0].style.setProperty('--pack', (1 - prog).toFixed(3));
  reels[1].style.setProperty('--pack', prog.toFixed(3));
  hubs.forEach((h) => h.style.setProperty('--spin', `${reelAngle.toFixed(1)}deg`));
  const count = Math.floor(counter);
  if (count !== lastCount) {
    lastCount = count;
    const s = String(count).padStart(3, '0');
    digits.forEach((d, i) => d.style.setProperty('--d', s[i]));
  }

  // Spectrum on the display, needle on the VU meter
  let level = 0;
  if (ctx) {
    analyser.getByteFrequencyData(freqData);
    bars.forEach((b, i) => {
      const lo = Math.floor(Math.pow(2, i * 0.45));
      const hi = Math.max(lo + 1, Math.floor(Math.pow(2, (i + 1) * 0.45)));
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += freqData[k];
      b.style.height = `${Math.max(8, (sum / (hi - lo) / 255) * 100).toFixed(0)}%`;
    });
    analyser.getFloatTimeDomainData(timeData);
    let rms = 0;
    for (let k = 0; k < timeData.length; k++) rms += timeData[k] * timeData[k];
    level = Math.sqrt(rms / timeData.length);
  }
  const db = 20 * Math.log10(level + 1e-5);
  const target = -48 + clamp((db + 40) / 40, 0, 1.1) * 96;
  // Needle ballistics: quick up, slower down
  vuAngle += (target - vuAngle) * (target > vuAngle ? 0.35 : 0.08);
  vu.style.setProperty('--a', `${vuAngle.toFixed(1)}deg`);

  let info;
  if (flash && now < flash.until) info = flash.text;
  else if (stopping) info = '■ STOP';
  else if (!playing) info = 'PRESS PLAY ▶';
  else if (clarity < 0.35) info = '~ STATIC ~';
  else {
    const label = tapeLabel.value.trim();
    const title = label ? `“${label}”` : station.name;
    const cue = mode === 'ff' ? ' ▶▶' : mode === 'rew' ? ' ◀◀' : '';
    info = `${recArmed ? '● ' : ''}${title} · ${station.bpm}${cue}`;
  }
  if (info !== lastInfo) {
    lastInfo = info;
    lcdInfo.textContent = info;
    lcdInfo.classList.toggle('blink', !playing && !stopping && !(flash && now < flash.until));
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateKeys();
