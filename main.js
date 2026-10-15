const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function restartAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/* ShyButton: dodges the mouse, gives up after a while, never dodges keyboard users */
(() => {
  const stage = document.querySelector('[data-shy-stage]');
  const btn = document.querySelector('[data-shy-btn]');
  const caption = document.querySelector('[data-shy-caption]');
  if (!stage) return;

  const lines = [
    'Oh! Hi.',
    'Please don’t.',
    'I’m not ready.',
    'Stop looking at me.',
    'This is so much attention.',
    '…okay. Fine. Click me.',
  ];
  const shyness = lines.length;
  let dodges = 0;
  let pos = { x: 0, y: 0 };
  let touchDodged = false;
  let resetTimer;

  function place(x, y) {
    pos = { x, y };
    btn.style.transform = `translate(${x}px, ${y}px)`;
  }

  function center() {
    place((stage.clientWidth - btn.offsetWidth) / 2, (stage.clientHeight - btn.offsetHeight) / 2);
  }

  function flee(px, py) {
    const pad = 12;
    const maxX = stage.clientWidth - btn.offsetWidth - pad;
    const maxY = stage.clientHeight - btn.offsetHeight - pad;
    let best = pos;
    let bestDist = -1;
    for (let i = 0; i < 30; i++) {
      const x = pad + Math.random() * (maxX - pad);
      const y = pad + Math.random() * (maxY - pad);
      const d = Math.hypot(x + btn.offsetWidth / 2 - px, y + btn.offsetHeight / 2 - py);
      if (d > bestDist) { best = { x, y }; bestDist = d; }
      if (d > 170) break;
    }
    place(best.x, best.y);
    dodges++;
    caption.textContent = lines[dodges - 1];
    if (dodges >= shyness) btn.textContent = 'Fine.';
  }

  function reset() {
    dodges = 0;
    btn.textContent = 'Click me';
    caption.textContent = 'Go ahead. Try. Again.';
    center();
  }

  center();
  requestAnimationFrame(() => btn.classList.add('ready'));
  window.addEventListener('resize', center);

  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || dodges >= shyness) return;
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const cx = pos.x + btn.offsetWidth / 2;
    const cy = pos.y + btn.offsetHeight / 2;
    if (Math.hypot(px - cx, py - cy) < 85) flee(px, py);
  });

  // Touch has no hover, so it dodges the tap itself instead
  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || dodges >= shyness) return;
    touchDodged = true;
    setTimeout(() => { touchDodged = false; }, 500);
    const r = stage.getBoundingClientRect();
    flee(e.clientX - r.left, e.clientY - r.top);
  });

  btn.addEventListener('click', (e) => {
    if (touchDodged) return;
    clearTimeout(resetTimer);
    if (e.detail === 0) caption.textContent = 'A keyboard user. You may pass.';
    else if (dodges < shyness) caption.textContent = 'Ow! You were fast. I wasn’t ready.';
    else caption.textContent = 'Clicked. Happy now?';
    btn.textContent = 'Clicked';
    resetTimer = setTimeout(reset, 3500);
  });
})();

/* ReluctantToggle: needs convincing to turn on, turns off instantly */
(() => {
  const toggle = document.querySelector('[data-toggle]');
  const caption = document.querySelector('[data-toggle-caption]');
  if (!toggle) return;

  const excuses = [
    'Hmm. Not today.',
    'Are you sure? It’s a big step.',
    'Can we talk about this first?',
    'Ugh. Fine. On.',
  ];
  let tries = 0;

  toggle.addEventListener('click', () => {
    if (toggle.getAttribute('aria-checked') === 'true') {
      toggle.setAttribute('aria-checked', 'false');
      caption.textContent = 'Off again. Finally, some rest.';
      tries = 0;
      return;
    }
    tries++;
    caption.textContent = excuses[tries - 1];
    if (tries < excuses.length) {
      restartAnimation(toggle, 'nope');
      return;
    }
    toggle.setAttribute('aria-checked', 'true');
  });
})();

/* ClingyCheckbox: pleads a few times before letting you uncheck */
(() => {
  const cb = document.querySelector('[data-clingy]');
  const label = document.querySelector('[data-clingy-label]');
  const caption = document.querySelector('[data-clingy-caption]');
  if (!cb) return;

  const pleas = [
    'Wait. Was it something I said?',
    'I can change. I’ll send fewer feelings.',
    'What if I only send feelings on weekends?',
  ];
  let attempts = 0;

  cb.addEventListener('click', (e) => {
    // `checked` already holds the new value here; preventDefault reverts it
    if (cb.checked) {
      caption.textContent = 'Yay! We’re friends now.';
      return;
    }
    if (attempts < pleas.length) {
      e.preventDefault();
      caption.textContent = pleas[attempts++];
      restartAnimation(label, 'shake');
      return;
    }
    attempts = 0;
    caption.textContent = '…okay. I’ll be right here if you change your mind.';
  });
})();

/* HastySlider: goes all the way to 100, then sheepishly back to your value */
(() => {
  const slider = document.querySelector('[data-hasty]');
  const out = document.querySelector('[data-hasty-out]');
  const caption = document.querySelector('[data-hasty-caption]');
  if (!slider) return;

  let busy = false;

  function show(v) {
    slider.value = v;
    slider.style.setProperty('--fill', `${v}%`);
    out.textContent = `${Math.round(v)}%`;
  }

  function tween(from, to, ms) {
    return new Promise((resolve) => {
      if (reducedMotion) { show(to); resolve(); return; }
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / ms);
        const eased = 1 - Math.pow(1 - t, 3);
        show(from + (to - from) * eased);
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  slider.addEventListener('input', () => { if (!busy) show(Number(slider.value)); });

  slider.addEventListener('change', async () => {
    if (busy) return;
    const target = Number(slider.value);
    if (target === 100) {
      caption.textContent = 'Already at 100. My kind of person.';
      return;
    }
    busy = true;
    caption.textContent = 'LET’S GO ALL THE WAY!';
    await tween(target, 100, 450);
    await wait(800);
    caption.textContent = `…sorry. Got excited. Back to ${target}%.`;
    await tween(100, target, 650);
    busy = false;
  });
})();

/* MoodySelect: sort order depends on mood, mood changes after every choice */
(() => {
  const select = document.querySelector('[data-moody]');
  const chip = document.querySelector('[data-mood]');
  const caption = document.querySelector('[data-moody-caption]');
  if (!select) return;

  const frameworks = [
    { name: 'Vanilla JS', year: 1995 },
    { name: 'jQuery', year: 2006 },
    { name: 'Angular', year: 2010 },
    { name: 'React', year: 2013 },
    { name: 'Vue', year: 2014 },
    { name: 'Svelte', year: 2016 },
    { name: 'Solid', year: 2018 },
    { name: 'Astro', year: 2021 },
  ];
  const byName = (a, b) => a.name.localeCompare(b.name);
  const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

  const moods = {
    cheerful: {
      note: 'A → Z, like a good citizen',
      sort: (a) => [...a].sort(byName),
      react: (v) => `${v}! Great choice! All choices are great!`,
    },
    grumpy: {
      note: 'Z → A. Don’t ask.',
      sort: (a) => [...a].sort(byName).reverse(),
      react: (v) => `${v}. Whatever.`,
    },
    sleepy: {
      note: 'shortest first, less reading',
      sort: (a) => [...a].sort((x, y) => x.name.length - y.name.length),
      react: (v) => `${v}… mm. sure. zzz`,
    },
    dramatic: {
      note: 'random. Everything is chaos.',
      sort: shuffle,
      react: (v) => `${v.toUpperCase()}?! THIS CHANGES EVERYTHING.`,
    },
    nostalgic: {
      note: 'oldest first',
      sort: (a) => [...a].sort((x, y) => x.year - y.year),
      react: (v) => (v === 'jQuery' ? 'jQuery. Those were the days.' : `${v}. Back in my day we had jQuery.`),
    },
  };
  const moodNames = Object.keys(moods);
  let mood = moodNames[Math.floor(Math.random() * moodNames.length)];

  function render() {
    const current = select.value;
    select.innerHTML = '';
    const placeholder = new Option('Choose…', '', !current, !current);
    placeholder.disabled = true;
    select.add(placeholder);
    for (const f of moods[mood].sort(frameworks)) {
      select.add(new Option(f.name, f.name, false, f.name === current));
    }
    chip.textContent = `Mood: ${mood} · ${moods[mood].note}`;
  }

  select.addEventListener('change', () => {
    caption.textContent = moods[mood].react(select.value);
    const others = moodNames.filter((m) => m !== mood);
    setTimeout(() => {
      mood = others[Math.floor(Math.random() * others.length)];
      render();
    }, 600);
  });

  render();
})();

/* JudgmentalPassword: honest feedback, entirely local */
(() => {
  const input = document.querySelector('[data-judge]');
  const reveal = document.querySelector('[data-judge-reveal]');
  const caption = document.querySelector('[data-judge-caption]');
  if (!input) return;

  function judge(v) {
    if (!v) return 'Go on. I won’t look.';
    const l = v.toLowerCase();
    if (/password|passord|lösenord|losenord/.test(l)) return 'Really? Really.';
    if (/vemund/.test(l)) return 'Using my name? I’m flattered. And concerned.';
    if (/^(123|abc|qwerty)/.test(l) || l.includes('1234')) return 'Ah, a classic. Like vinyl, but unsafe.';
    if (v.length > 2 && /^(.)\1+$/.test(v)) return 'Bold strategy: the same key, repeatedly.';
    if (v.length < 6) return 'Short. Like my patience.';
    const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(v)).length;
    if (v.length >= 14 && kinds >= 3) return 'Okay, that’s actually good. I’m annoyed.';
    if (kinds === 1) return 'One kind of character. Minimalist. Hackers love minimalism.';
    if (v.length < 10) return 'Getting there. A few more characters and I might stop judging.';
    return 'Long, but predictable. Like a Scandinavian summer.';
  }

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { caption.textContent = judge(input.value); }, 300);
  });

  reveal.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    reveal.textContent = show ? 'Hide' : 'Show';
    reveal.setAttribute('aria-pressed', String(show));
    if (show) caption.textContent = 'I said I wouldn’t look. You looked.';
  });
})();

/* OverdueProgress: fast to 90%, then never quite done */
(() => {
  const btn = document.querySelector('[data-overdue-start]');
  const bar = document.querySelector('[data-overdue-bar]');
  const fill = document.querySelector('[data-overdue-fill]');
  const msg = document.querySelector('[data-overdue-msg]');
  const pct = document.querySelector('[data-overdue-pct]');
  if (!btn) return;

  const timeline = [
    [0, 'Uploading…'],
    [1500, 'Almost there.'],
    [3500, 'Any second now.'],
    [5500, 'Reticulating splines.'],
    [7500, 'This one’s on me, honestly.'],
  ];
  const giveUpAfter = 9500;

  btn.addEventListener('click', () => {
    btn.disabled = true;
    let p = 0;
    const start = performance.now();
    const interval = setInterval(() => {
      const elapsed = performance.now() - start;
      p = p < 90 ? Math.min(90, p + 5 + Math.random() * 5) : p + (99.99 - p) * 0.08;
      fill.style.width = `${p}%`;
      bar.setAttribute('aria-valuenow', p.toFixed(0));
      pct.textContent = `${p >= 99 ? p.toFixed(2) : p.toFixed(0)}%`;
      const line = timeline.filter(([t]) => elapsed >= t).pop();
      if (line) msg.textContent = line[1];
      if (elapsed >= giveUpAfter) {
        clearInterval(interval);
        msg.textContent = 'Overdue. Like everything else here.';
        btn.textContent = 'Try again';
        btn.disabled = false;
      }
    }, 120);
  });
})();
