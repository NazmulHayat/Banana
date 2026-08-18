/* Shared helpers for Aight Bet design demos (throwaway). */

// Deterministic pseudo-random so demos look identical every load.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Generate a streaky year of completion levels (0..3) for a habit.
// Returns array of {level} for `days` days, ending today.
function genYear(seed, days = 364) {
  const rng = makeRng(seed);
  const out = [];
  let streak = 0;
  for (let i = 0; i < days; i++) {
    const keep = rng() < (streak > 0 ? 0.78 : 0.5);
    if (keep) {
      streak++;
      const lvl = streak > 8 ? 3 : streak > 3 ? 2 : 1;
      out.push(lvl);
    } else {
      streak = 0;
      out.push(0);
    }
  }
  // guarantee a strong recent streak for the hero number
  for (let i = out.length - 12; i < out.length; i++) out[i] = i % 11 === 0 ? 2 : 3;
  return out;
}

// Build a heatmap into `el`: columns of weeks, `rows` rows (default 7).
function buildHeatmap(el, levels, cols, { stagger = 8, today = true, rows = 7 } = {}) {
  const weeks = cols;
  const total = weeks * rows;
  const data = levels.slice(-total);
  el.style.gridTemplateColumns = `repeat(${weeks}, 1fr)`;
  el.style.gridAutoFlow = 'column';
  el.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  el.innerHTML = '';
  data.forEach((lvl, i) => {
    const c = document.createElement('div');
    c.className = `cell l${lvl}`;
    if (today && i === data.length - 1) c.classList.add('today');
    c.style.animationDelay = `${(i % 40) * stagger}ms`;
    el.appendChild(c);
  });
}

// Count a number up from 0 to target inside `el`.
function countUp(el, target, ms = 900) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Simple screen navigation by id.
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.scrollTop = 0;
  if (el.dataset.oninit) window[el.dataset.oninit] && window[el.dataset.oninit]();
}

// Lock/unlock toggle for paywall preview.
function setLocked(scopeEl, locked) {
  scopeEl.classList.toggle('locked', locked);
  const lk = scopeEl.querySelector('[data-lockbtn]');
  const un = scopeEl.querySelector('[data-unlockbtn]');
  if (lk && un) { lk.classList.toggle('on', locked); un.classList.toggle('on', !locked); }
}
