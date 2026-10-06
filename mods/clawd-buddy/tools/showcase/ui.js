'use strict';
/* Oberfläche des Showcase. Nutzt die gebündelten Module des Mods (tools/build-showcase.mjs): Engine, Bühne, Bibliothek. */
const { createEngine } = __req('hooks/engine.ts');
const { W, H, TICK, PAL, POSE_NAMES } = __req('hooks/stage.ts');
const { ALL_CLIPS, ALL_PROPS, CAT_LABEL } = __req('hooks/library.ts');

const MOODS = [
  ['idle', 'Leerlauf'], ['watching', 'Du tippst'], ['work_think', 'Denkt'], ['work_read', 'Liest'], ['work_write', 'Schreibt'],
  ['work_shell', 'Shell'], ['work_git', 'Commit'], ['work_test', 'Tests/Checks'], ['work_web', 'Web'], ['work_agent', 'Subagent'], ['agent_done', 'Subagent fertig'], ['limit_5h', 'Limit 5 h voll'], ['limit_week', 'Limit Woche voll'], ['limit_back', 'Limit zurückgesetzt'], ['wait10', 'Tool > 10 s'], ['wait60', 'Tool > 60 s'],
  ['waitUser', 'Wartet auf dich'], ['waitUserLong', 'Wartet lange'], ['streak', 'Erfolgsserie'], ['done', 'Fertig ✓'], ['oops', 'Fehler ✗'],
];
const label = (m) => (MOODS.find((x) => x[0] === m) || [m, m])[1];
const nowHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };

const logEl = document.getElementById('log'); const LOG = [];
function log(s) {
  const ts = ((engine ? engine.S.ticks : 0) * TICK / 1000).toFixed(1).padStart(6);
  LOG.unshift(`${ts}s  ${s}`); LOG.length = Math.min(LOG.length, 80); logEl.innerHTML = LOG.join('\n');
}
const engine = createEngine({ clips: ALL_CLIPS, props: ALL_PROPS, rng: Math.random, hour: nowHour(), idleSeconds: 8, onLog: log });
const S = engine.S;
let paused = false, speed = 1, scen = null, scale = 10, view = 'px';

/* ---- Zeichnen */
const cv = document.getElementById('cv'), ctx = cv.getContext('2d'), txt = document.getElementById('txt');
// Die Bühne nimmt die ganze Leiste über der Eingabe ein; der Maßstab passt sich der Breite an (höchstens der eingestellte Wert).
let scaleWanted = scale;
function sizeStage() {
  const band = document.querySelector('.band').clientWidth || W * scaleWanted;
  scale = Math.max(2, Math.min(scaleWanted, Math.floor(band / W)));
  cv.width = W * scale; cv.height = H * scale;
  cv.style.width = W * scale + 'px'; cv.style.height = H * scale + 'px';
  txt.style.fontSize = (scale / 0.6) + 'px';
}
window.addEventListener('resize', sizeStage);
function draw() {
  const { buf } = engine.render();
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (view === 'px') {
    cv.style.opacity = 1; txt.hidden = true;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = buf[y * W + x]; if (!c) continue;
      ctx.fillStyle = PAL[c]; ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  } else {
    cv.style.opacity = 0; txt.hidden = false;
    let html = '';
    for (let r = 0; r < H / 2; r++) {
      for (let x = 0; x < W; x++) {
        const t = buf[(2 * r) * W + x], b = buf[(2 * r + 1) * W + x];
        const st = `width:${scale}px;height:${2 * scale}px;line-height:${2 * scale}px;`;
        if (!t && !b) html += `<span style="${st}"> </span>`;
        else if (t && !b) html += `<span style="${st}color:${PAL[t]}">▀</span>`;
        else if (!t && b) html += `<span style="${st}color:${PAL[b]}">▄</span>`;
        else html += `<span style="${st}color:${PAL[t]};background:${PAL[b]}">▀</span>`;
      }
      html += '\n';
    }
    txt.innerHTML = html;
  }
  renderStatus();
}

function renderStatus() {
  const pl = S.play;
  document.getElementById('sClip').textContent = pl ? `${pl.clip.label} (${pl.clip.name})` : '–';
  const list = pl ? pl[pl.phase === 'end' ? 'body' : pl.phase] : [];
  document.getElementById('sPose').textContent = pl ? `${POSE_NAMES[pl.clip.from] || pl.clip.from} · ${pl.phase} ${Math.min(pl.fi + 1, list.length)}/${list.length}` : '–';
  const night = engine.isNight();
  document.getElementById('sMood').textContent = `${label(S.mood)}${S.gallery ? ' · Galerie' : ''}${night ? ' · Nacht' : ''}${S.sleepStage ? ' · Schlafstufe ' + S.sleepStage : ''}${S.carry ? ' · Gegenstand bleibt stehen' : ''}`;
  document.getElementById('sQueue').textContent = S.queue.length ? S.queue.map((q) => (typeof q === 'string' ? q : q.name)).join(' → ') : (S.pending ? 'wartet auf sicheren Frame' : '–');
  document.getElementById('sAnnoy').textContent = `${S.annoy} / 6`;
  document.getElementById('mAnnoy').style.width = Math.min(100, S.annoy / 6 * 100) + '%';
  document.getElementById('sIdle').textContent = `${(S.idleTicks * TICK / 1000).toFixed(0)} s (Grenze ${(S.idleLimit * TICK / 1000).toFixed(0)} s)`;
  document.querySelectorAll('.group button').forEach((b) => b.classList.toggle('playing', !!pl && b.dataset.clip === pl.clip.name));
}

/* ---- Oberfläche */
// Subagenten wie im Mod: „Subagent“ = einer läuft (sein Helfer bleibt stehen), „Viele“ = 5, „Subagent fertig“ beendet ihn (Geschenk, dann sinkt er ab)
function agentsFor(k) {
  // Jeder Klick auf „Subagent“ bringt einen Helfer mehr (bis 12; ab 7 zweite Reihe)
  if (k === 'work_agent') engine.set({ agents: Math.min(12, (S.agents || 0) + 1) });
  else if (k === 'agent_done') engine.set({ agents: 0 });
}
function renderMoodButtons() {
  const el = document.getElementById('moods'); el.innerHTML = '';
  for (const [k, l] of MOODS) {
    const b = document.createElement('button'); b.textContent = l; if (S.mood === k && !S.gallery) b.classList.add('on');
    b.onclick = () => { scen = null; document.getElementById('scenarioBtn').textContent = '▶ Szenario abspielen'; agentsFor(k); engine.setMood(k); renderMoodButtons(); };
    el.appendChild(b);
  }
}
function renderGallery() {
  const el = document.getElementById('groups'); el.innerHTML = '';
  const groups = {};
  ALL_CLIPS.forEach((c) => (groups[c.cat] = groups[c.cat] || []).push(c));
  for (const cat of Object.keys(CAT_LABEL)) {
    if (!groups[cat]) continue;
    const g = document.createElement('div'); g.className = 'group';
    g.innerHTML = `<h3>${CAT_LABEL[cat]} · ${groups[cat].length}</h3>`;
    const bs = document.createElement('div'); bs.className = 'btns';
    for (const c of groups[cat]) {
      const b = document.createElement('button'); b.textContent = c.label; b.dataset.clip = c.name;
      b.title = `${c.name} · ${POSE_NAMES[c.from]}${c.to !== c.from ? ' → ' + POSE_NAMES[c.to] : ''}${c.loop ? ' · Schleife' : ''}${c.intro.length ? ' · mit Hervorholen' : ''}`;
      b.onclick = () => { scen = null; engine.play(c.name, document.getElementById('loopGal').checked); renderMoodButtons(); };
      bs.appendChild(b);
    }
    g.appendChild(bs); el.appendChild(g);
  }
}
function setHour(h) {
  engine.set({ hour: h });
  document.getElementById('hour').value = h;
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  document.getElementById('hourVal').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const nb = document.getElementById('nightBadge');
  nb.textContent = engine.isNight() ? 'Nacht' : engine.isMorning() ? 'Morgen' : 'Tag'; nb.className = 'badge' + (engine.isNight() ? ' night' : '');
  if (!engine.isNight() && S.sleepStage && S.mood === 'idle') engine.wakeUp();
}

/* ---- Eingaben (Zeiger in Bühnenpixeln) */
function stageXY(ev) {
  const r = cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H };
}
cv.addEventListener('pointermove', (ev) => { const q = stageXY(ev); engine.pointer('move', q.x, q.y); });
cv.addEventListener('pointerleave', () => engine.pointer('leave', 0, 0));
cv.addEventListener('pointerdown', (ev) => {
  const q = stageXY(ev);
  if (engine.pointer('down', q.x, q.y)) { cv.setPointerCapture(ev.pointerId); cv.classList.add('dragging'); }
});
cv.addEventListener('pointerup', (ev) => { cv.classList.remove('dragging'); const q = stageXY(ev); engine.pointer('up', q.x, q.y); });

/* ---- Laune: Knöpfe rechnen mit derselben Formel wie der Mod (mood.ts), Zeit = Simulationszeit */
const M = __req('hooks/mood.ts');
let strain = { ...M.NO_STRAIN }, extraWork = 0;
const simNow = () => S.ticks * TICK + extraWork;
function showTemper(t, tired) {
  engine.set({ temper: t, tired });
  document.getElementById('temper').value = t; document.getElementById('tired').value = tired;
  document.getElementById('temperVal').textContent = t.toFixed(2);
  document.getElementById('tiredVal').textContent = Math.round(tired * 100) + ' %';
  const b = document.getElementById('temperBadge');
  b.textContent = t <= -0.6 ? 'sehr gereizt' : t <= -0.2 ? 'gereizt' : t >= 0.5 ? 'bester Laune' : t >= 0.2 ? 'gut gelaunt' : 'ausgeglichen';
  b.className = 'badge' + (t <= -0.2 ? ' night' : '');
}
function fromStrain(what) { const t = M.deriveTemper(strain, simNow()); showTemper(t.temper, t.tired); log(`Laune: <b>${what}</b> → ${t.temper.toFixed(2)}, müde ${Math.round(t.tired * 100)} %`); engine.requestChange(); }
document.getElementById('hitTool').onclick = () => { strain = M.addHit(strain, simNow(), M.SETBACK.toolError); strain = { ...strain, streak: 0 }; fromStrain('Tool-Fehler'); };
document.getElementById('hitTurn').onclick = () => { strain = M.strainTurnEnd(M.strainTurnStart(strain, simNow()), simNow(), false, false); fromStrain('Turn gescheitert'); };
document.getElementById('hitOk').onclick = () => { strain = M.strainTurnEnd(M.strainTurnStart(strain, simNow()), simNow(), true, true); fromStrain('Erfolg'); };
document.getElementById('hitWork').onclick = () => { const n = simNow(); strain = { ...strain, workMs: strain.workMs + 3600000, lastWorkAt: n }; fromStrain('+1 h Arbeit'); };
document.getElementById('hitReset').onclick = () => { strain = { ...M.NO_STRAIN }; fromStrain('zurückgesetzt'); };
document.getElementById('temper').oninput = (e) => showTemper(+e.target.value, +document.getElementById('tired').value);
document.getElementById('tired').oninput = (e) => showTemper(+document.getElementById('temper').value, +e.target.value);

document.getElementById('hour').oninput = (e) => setHour(+e.target.value);
document.getElementById('nowBtn').onclick = () => setHour(nowHour());
// Besondere Tage (im Mod aus Datum und Einstellung „Geburtstag“)
document.getElementById('special').onchange = (e) => { engine.set({ special: e.target.value }); engine.requestChange(); log(`Besonderer Tag: <b>${e.target.selectedOptions[0].textContent}</b>`); };
document.getElementById('nightBtn').onclick = () => setHour(23.5);
document.getElementById('morningBtn').onclick = () => setHour(7.25);
document.getElementById('backBtn').onclick = () => { scen = null; engine.welcome(); renderMoodButtons(); };
for (const id of ['nStart', 'nEnd']) {
  const sel = document.getElementById(id);
  for (let h = 0; h < 24; h++) { const o = document.createElement('option'); o.value = h; o.textContent = String(h).padStart(2, '0') + ':00'; sel.appendChild(o); }
  sel.value = id === 'nStart' ? S.nightStart : S.nightEnd;
  sel.onchange = () => { engine.set({ nightStart: +document.getElementById('nStart').value, nightEnd: +document.getElementById('nEnd').value }); setHour(S.hour); };
}
document.getElementById('speed').oninput = (e) => { speed = +e.target.value; document.getElementById('speedVal').textContent = speed + '×'; };
document.getElementById('idleSec').oninput = (e) => { engine.set({ idleSeconds: +e.target.value }); document.getElementById('idleVal').textContent = e.target.value + ' s'; };
document.getElementById('scale').oninput = (e) => { scaleWanted = +e.target.value; sizeStage(); document.getElementById('scaleVal').textContent = scale; };
document.getElementById('view').onchange = (e) => { view = e.target.value; };
document.getElementById('reduced').onchange = (e) => { engine.set({ reduced: e.target.checked }); engine.requestChange(); };
document.getElementById('galStop').onclick = () => { S.gallery = null; engine.requestChange(); renderMoodButtons(); };
document.getElementById('pauseBtn').onclick = (e) => { paused = !paused; e.target.textContent = paused ? 'Weiter' : 'Pause'; };

/* ---- Szenario: Stimmungen und Tageszeit nacheinander (ca. 105 s) */
const SCENARIO = [
  [0, () => engine.setMood('idle')], [3, () => engine.setMood('watching')], [6, () => engine.setMood('work_think')], [9, () => engine.setMood('work_read')],
  [13, () => engine.setMood('work_write')], [18, () => engine.setMood('work_shell')], [21, () => engine.setMood('wait10')], [28, () => engine.setMood('wait60')],
  [36, () => engine.setMood('done')], [38, () => { agentsFor('work_agent'); engine.setMood('work_agent'); }], [43, () => { agentsFor('agent_done'); engine.setMood('agent_done'); }], [45, () => engine.setMood('waitUser')], [50, () => engine.setMood('oops')],
  [54, () => engine.setMood('idle')], [64, () => setHour(23.5)], [92, () => engine.setMood('work_write')], [100, () => engine.setMood('idle')],
  [104, () => setHour(nowHour())],
];
function runScenario() {
  if (!scen) return;
  const sec = (S.ticks - scen.start) * TICK / 1000;
  while (scen.i < SCENARIO.length && SCENARIO[scen.i][0] <= sec) { SCENARIO[scen.i][1](); scen.i++; }
  if (scen.i >= SCENARIO.length) { scen = null; log('<b>Szenario Ende</b>'); document.getElementById('scenarioBtn').textContent = '▶ Szenario abspielen'; }
  renderMoodButtons();
}
document.getElementById('scenarioBtn').onclick = (e) => {
  if (scen) { scen = null; e.target.textContent = '▶ Szenario abspielen'; return; }
  S.gallery = null; scen = { start: S.ticks, i: 0 }; e.target.textContent = '■ Szenario stoppen'; log('<b>Szenario Start</b> (ca. 105 s)');
};
document.getElementById('ph').textContent = 'Schreib etwas …';

/* ---- Schleife: Takt unabhängig vom Zeichnen (läuft auch in Hintergrund-Tabs) */
sizeStage(); renderMoodButtons(); renderGallery(); setHour(S.hour);
document.getElementById('idleVal').textContent = (S.idleLimit * TICK / 1000) + ' s';
let acc = 0, last = performance.now();
setInterval(() => {
  const now = performance.now(), dt = now - last; last = now;
  if (paused) return;
  acc += dt * speed; let n = 0;
  while (acc >= TICK && n < 30) { engine.tick(); runScenario(); acc -= TICK; n++; }
  if (n === 30) acc = 0;
}, 20);
function frame() { draw(); requestAnimationFrame(frame); }
engine.start();
requestAnimationFrame(frame);
window.__clawd = { engine, S };
