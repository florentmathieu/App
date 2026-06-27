import { ChiptuneEngine, midiToFreq, midiToName, isSharp } from './audio.js';

// ============================================================================
// Configuration
// ============================================================================
const DRUM_LANES = [
  { id: 'kick',    label: 'Kick',     kind: 'kick',    gain: 1.0 },
  { id: 'snare',   label: 'Snare',    kind: 'snare',   gain: 0.9 },
  { id: 'hat',     label: 'Hi-hat',   kind: 'hat',     gain: 0.7 },
  { id: 'openhat', label: 'Open hat', kind: 'openhat', gain: 0.6 },
  { id: 'clap',    label: 'Clap',     kind: 'clap',    gain: 0.8 },
  { id: 'tom',     label: 'Tom',      kind: 'tom',     gain: 0.85 },
];

// Melodic tracks (mini piano-rolls). top row = highest pitch.
const PITCHED_TRACKS = [
  { id: 'bass',  title: 'Bass',   lo: 36, hi: 55, accent: '#4fc3f7', defType: 'triangle', base: 0.50, vol: 0.85 },
  { id: 'lead',  title: 'Lead',   lo: 57, hi: 79, accent: '#b388ff', defType: 'square',   base: 0.45, vol: 0.75 },
  { id: 'lead2', title: 'Lead 2', lo: 60, hi: 84, accent: '#ffd166', defType: 'sawtooth', base: 0.40, vol: 0.60 },
];
const PT = Object.fromEntries(PITCHED_TRACKS.map(t => [t.id, t]));

function notesOf(t) {
  const a = [];
  for (let m = t.hi; m >= t.lo; m--) a.push(m);
  return a;
}

const CHORDS = { off: null, maj: [0, 4, 7], min: [0, 3, 7] };
const STEP_OPTIONS = [8, 16, 32];
const STORAGE_KEY = 'chiptune-mvp-v3';
const OLD_KEYS = ['chiptune-mvp-v2'];
const LIBRARY_KEY = 'chiptune-songs-v1';

// ============================================================================
// State
// ============================================================================
const engine = new ChiptuneEngine();
let state = normalizeState(loadAutosave() || {});
let playingPattern = -1;

function emptyPattern(steps) {
  const drum = {};
  for (const lane of DRUM_LANES) drum[lane.id] = new Array(steps).fill(false);
  const p = { drum };
  for (const t of PITCHED_TRACKS) p[t.id] = { cells: {} };
  return p;
}

// Backfill any missing fields so old saves / fresh state both work.
function normalizeState(s) {
  s = s || {};
  s.name = typeof s.name === 'string' ? s.name : 'Sans titre';
  s.bpm = s.bpm || 120;
  s.steps = STEP_OPTIONS.includes(s.steps) ? s.steps : 16;

  s.meta = s.meta || {};
  s.meta.drum = Object.assign({ expanded: true, muted: false, volume: 0.9 }, s.meta.drum || {});
  for (const t of PITCHED_TRACKS) {
    s.meta[t.id] = Object.assign(
      { expanded: false, muted: false, type: t.defType, chord: 'off', volume: t.vol },
      s.meta[t.id] || {}
    );
  }

  if (!Array.isArray(s.patterns) || !s.patterns.length) s.patterns = [emptyPattern(s.steps)];
  for (const p of s.patterns) {
    p.drum = p.drum || {};
    for (const lane of DRUM_LANES) {
      const old = Array.isArray(p.drum[lane.id]) ? p.drum[lane.id] : [];
      const next = new Array(s.steps).fill(false);
      for (let i = 0; i < Math.min(s.steps, old.length); i++) next[i] = old[i];
      p.drum[lane.id] = next;
    }
    for (const t of PITCHED_TRACKS) {
      p[t.id] = p[t.id] || { cells: {} };
      p[t.id].cells = p[t.id].cells || {};
      for (const k of Object.keys(p[t.id].cells)) {
        if (parseInt(k.split(':')[1], 10) >= s.steps) delete p[t.id].cells[k];
      }
    }
  }

  s.editPattern = Number.isInteger(s.editPattern) ? s.editPattern : 0;
  if (s.editPattern >= s.patterns.length) s.editPattern = 0;
  s.chain = (Array.isArray(s.chain) && s.chain.length)
    ? s.chain.filter(i => i < s.patterns.length) : [0];
  if (!s.chain.length) s.chain = [0];
  return s;
}

function editP() { return state.patterns[state.editPattern]; }
function patternLetter(i) { return String.fromCharCode(65 + i); }

function resizeAll(steps) {
  for (const p of state.patterns) {
    for (const lane of DRUM_LANES) {
      const old = p.drum[lane.id] || [];
      const next = new Array(steps).fill(false);
      for (let i = 0; i < Math.min(steps, old.length); i++) next[i] = old[i];
      p.drum[lane.id] = next;
    }
    for (const t of PITCHED_TRACKS) {
      for (const k of Object.keys(p[t.id].cells)) {
        if (parseInt(k.split(':')[1], 10) >= steps) delete p[t.id].cells[k];
      }
    }
  }
}

// ============================================================================
// Persistence (autosave of the working song)
// ============================================================================
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); } catch (e) {}
}
function loadAutosave() {
  for (const key of [STORAGE_KEY, ...OLD_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) { const s = JSON.parse(raw); if (s && (s.patterns || s.tracks)) return s; }
    } catch (e) {}
  }
  return null;
}
function snapshot() {
  return JSON.parse(JSON.stringify({
    name: state.name, bpm: state.bpm, steps: state.steps, meta: state.meta,
    patterns: state.patterns, editPattern: state.editPattern, chain: state.chain,
  }));
}

// ============================================================================
// Song library (named saves)
// ============================================================================
function loadLibrary() {
  try { return JSON.parse(localStorage.getItem(LIBRARY_KEY)) || {}; } catch (e) { return {}; }
}
function writeLibrary(lib) {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); } catch (e) {}
}
function saveSong(name) {
  name = (name || '').trim();
  if (!name) return false;
  state.name = name;
  const lib = loadLibrary();
  const snap = snapshot();
  snap.savedAt = Date.now();
  lib[name] = snap;
  writeLibrary(lib);
  saveState();
  return true;
}
function applyState(s) {
  state = normalizeState(s);
  playingPattern = -1;
  syncTransportUI();
  renderAll();
  saveState();
}

// ============================================================================
// Sequencer data -> voices (volume + mute baked in here)
// ============================================================================
engine.stepProvider = (step, patternIndex) => {
  const p = state.patterns[patternIndex];
  if (!p) return [];
  const voices = [];
  const secPerStep = 60.0 / state.bpm / (state.steps / 4);
  const dur = secPerStep * 0.9;

  const dm = state.meta.drum;
  if (!dm.muted) {
    for (const lane of DRUM_LANES) {
      if (p.drum[lane.id] && p.drum[lane.id][step]) {
        voices.push({ kind: lane.kind, gain: lane.gain * dm.volume });
      }
    }
  }
  for (const t of PITCHED_TRACKS) {
    const m = state.meta[t.id];
    if (m.muted) continue;
    const g = t.base * m.volume;
    const cells = p[t.id].cells;
    for (const key of Object.keys(cells)) {
      const [midi, s] = key.split(':').map(Number);
      if (s === step && cells[key]) {
        voices.push({ kind: 'tone', freq: midiToFreq(midi), dur, gain: g, type: m.type });
      }
    }
  }
  return voices;
};

function previewDur() { return 60.0 / state.bpm / (state.steps / 4) * 0.9; }

// ============================================================================
// Song panel: library bar + patterns + chain + export
// ============================================================================
const songEl = document.getElementById('song');

function renderSong() {
  songEl.innerHTML = '';
  songEl.appendChild(renderLibraryBar());
  songEl.appendChild(renderPatternsRow());
  songEl.appendChild(renderChainRow());
  songEl.appendChild(renderExportRow());
}

function renderLibraryBar() {
  const row = document.createElement('div');
  row.className = 'song-row';
  row.innerHTML = `<span class="song-label">Morceau</span>`;
  const name = document.createElement('input');
  name.className = 'song-name';
  name.type = 'text';
  name.value = state.name;
  name.placeholder = 'Sans titre';
  name.addEventListener('change', () => { state.name = name.value.trim() || 'Sans titre'; saveState(); });
  row.appendChild(name);

  const tools = document.createElement('div');
  tools.className = 'song-tools';
  tools.appendChild(iconBtn('💾', 'Sauvegarder', () => {
    const n = prompt('Nom du morceau :', state.name);
    if (n && saveSong(n)) { renderSong(); toast(`« ${state.name} » sauvegardé`); }
  }));
  tools.appendChild(iconBtn('📂', 'Mes morceaux', openLibraryModal));
  tools.appendChild(iconBtn('＋', 'Nouveau morceau', () => {
    if (confirm('Nouveau morceau ? (le travail non sauvegardé sera perdu)')) {
      applyState({});
    }
  }));
  row.appendChild(tools);
  return row;
}

function renderPatternsRow() {
  const row = document.createElement('div');
  row.className = 'song-row';
  row.innerHTML = `<span class="song-label">Motifs</span>`;
  const chips = document.createElement('div');
  chips.className = 'chips';
  state.patterns.forEach((_, i) => {
    const chip = document.createElement('button');
    chip.className = 'chip pat'
      + (i === state.editPattern ? ' editing' : '')
      + (i === playingPattern ? ' playing' : '');
    chip.textContent = patternLetter(i);
    chip.addEventListener('click', () => { state.editPattern = i; saveState(); renderAll(); });
    chips.appendChild(chip);
  });
  row.appendChild(chips);

  const tools = document.createElement('div');
  tools.className = 'song-tools';
  tools.appendChild(iconBtn('＋', 'Nouveau motif', () => {
    state.patterns.push(emptyPattern(state.steps));
    state.editPattern = state.patterns.length - 1;
    saveState(); renderAll();
  }));
  tools.appendChild(iconBtn('⧉', 'Dupliquer', () => {
    state.patterns.splice(state.editPattern + 1, 0, JSON.parse(JSON.stringify(editP())));
    state.editPattern += 1;
    saveState(); renderAll();
  }));
  tools.appendChild(iconBtn('🗑', 'Supprimer', () => {
    if (state.patterns.length <= 1) return;
    const removed = state.editPattern;
    state.patterns.splice(removed, 1);
    state.chain = state.chain.filter(i => i !== removed).map(i => (i > removed ? i - 1 : i));
    if (!state.chain.length) state.chain = [0];
    if (state.editPattern >= state.patterns.length) state.editPattern = state.patterns.length - 1;
    engine.setChain(state.chain);
    saveState(); renderAll();
  }, state.patterns.length <= 1));
  row.appendChild(tools);
  return row;
}

function renderChainRow() {
  const row = document.createElement('div');
  row.className = 'song-row';
  row.innerHTML = `<span class="song-label">Chaîne</span>`;
  const chips = document.createElement('div');
  chips.className = 'chips chain';
  state.chain.forEach((patIdx, pos) => {
    const chip = document.createElement('button');
    chip.className = 'chip slot' + (patIdx === playingPattern ? ' playing' : '');
    chip.textContent = patternLetter(patIdx);
    chip.title = 'Retirer de la chaîne';
    chip.addEventListener('click', () => {
      if (state.chain.length <= 1) return;
      state.chain.splice(pos, 1);
      engine.setChain(state.chain);
      saveState(); renderSong();
    });
    chips.appendChild(chip);
  });
  row.appendChild(chips);

  const tools = document.createElement('div');
  tools.className = 'song-tools';
  tools.appendChild(iconBtn(`＋ ${patternLetter(state.editPattern)}`, 'Ajouter à la chaîne', () => {
    state.chain.push(state.editPattern);
    engine.setChain(state.chain);
    saveState(); renderSong();
  }, false, 'wide'));
  row.appendChild(tools);
  return row;
}

function renderExportRow() {
  const row = document.createElement('div');
  row.className = 'song-row';
  row.innerHTML = `<span class="song-label">Export</span>`;
  const tools = document.createElement('div');
  tools.className = 'song-tools';
  tools.appendChild(iconBtn('⬇ MP3', 'Exporter en MP3', (e) => doExport('mp3', e.target), false, 'wide'));
  tools.appendChild(iconBtn('⬇ WAV', 'Exporter en WAV', (e) => doExport('wav', e.target), false, 'wide'));
  row.appendChild(tools);
  return row;
}

function iconBtn(label, title, onClick, disabled = false, extra = '') {
  const b = document.createElement('button');
  b.className = 'song-btn ' + extra;
  b.textContent = label;
  b.title = title;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

// ============================================================================
// Export
// ============================================================================
async function doExport(fmt, btn) {
  engine.setBpm(state.bpm); engine.setSteps(state.steps); engine.setChain(state.chain);
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Rendu…'; }
  try {
    const blob = fmt === 'mp3' ? await engine.renderMp3(160) : await engine.renderWav();
    downloadBlob(blob, `${safeName()}.${fmt}`);
    toast(`Export ${fmt.toUpperCase()} prêt`);
  } catch (e) {
    alert('Export échoué : ' + (e && e.message ? e.message : e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}
function safeName() {
  return (state.name || 'picotune').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'picotune';
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ============================================================================
// Library modal
// ============================================================================
function openLibraryModal() {
  const lib = loadLibrary();
  const names = Object.keys(lib).sort((a, b) => (lib[b].savedAt || 0) - (lib[a].savedAt || 0));

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const modal = document.createElement('div');
  modal.className = 'modal';
  const head = document.createElement('div');
  head.className = 'modal-head';
  head.innerHTML = `<h2>Mes morceaux</h2>`;
  const close = document.createElement('button');
  close.className = 'modal-close'; close.textContent = '✕';
  close.addEventListener('click', () => overlay.remove());
  head.appendChild(close);
  modal.appendChild(head);

  const list = document.createElement('div');
  list.className = 'lib-list';
  if (!names.length) {
    list.innerHTML = `<p class="lib-empty">Aucun morceau sauvegardé.<br>Utilise 💾 pour en enregistrer un.</p>`;
  }
  for (const name of names) {
    const row = document.createElement('div');
    row.className = 'lib-item';
    const when = lib[name].savedAt ? new Date(lib[name].savedAt).toLocaleDateString() : '';
    const info = document.createElement('div');
    info.className = 'lib-info';
    info.innerHTML = `<span class="lib-name">${escapeHtml(name)}</span><span class="lib-date">${when}</span>`;
    row.appendChild(info);

    const acts = document.createElement('div');
    acts.className = 'lib-acts';
    const load = document.createElement('button');
    load.className = 'song-btn wide'; load.textContent = 'Charger';
    load.addEventListener('click', () => { applyState(JSON.parse(JSON.stringify(lib[name]))); overlay.remove(); toast(`« ${name} » chargé`); });
    const exp = document.createElement('button');
    exp.className = 'song-btn'; exp.textContent = '⬇'; exp.title = 'Exporter .json';
    exp.addEventListener('click', () => downloadBlob(new Blob([JSON.stringify(lib[name])], { type: 'application/json' }), name.replace(/[^\w\-]+/g, '_') + '.json'));
    const del = document.createElement('button');
    del.className = 'song-btn'; del.textContent = '🗑'; del.title = 'Supprimer';
    del.addEventListener('click', () => {
      if (!confirm(`Supprimer « ${name} » ?`)) return;
      const l = loadLibrary(); delete l[name]; writeLibrary(l); overlay.remove(); openLibraryModal();
    });
    acts.append(load, exp, del);
    row.appendChild(acts);
    list.appendChild(row);
  }
  modal.appendChild(list);

  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  const imp = document.createElement('label');
  imp.className = 'song-btn wide'; imp.textContent = '📥 Importer .json';
  const file = document.createElement('input');
  file.type = 'file'; file.accept = 'application/json,.json'; file.style.display = 'none';
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try {
      const txt = await f.text();
      const obj = JSON.parse(txt);
      applyState(obj);
      if (obj && obj.name) saveSong(obj.name);
      overlay.remove();
      toast('Morceau importé');
    } catch (e) { alert('Import échoué : fichier invalide'); }
  });
  imp.appendChild(file);
  foot.appendChild(imp);
  modal.appendChild(foot);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================================
// Tracks rendering
// ============================================================================
const tracksEl = document.getElementById('tracks');

function renderTracks() {
  tracksEl.innerHTML = '';
  tracksEl.appendChild(renderDrumTrack());
  for (const t of PITCHED_TRACKS) tracksEl.appendChild(renderPitchTrack(t));
  lastStep = -1;
}

function beatClass(step) { return step % 4 === 0 ? ' beat' : ''; }

function volumeControl(id) {
  const row = document.createElement('div');
  row.className = 'track-tools vol-row';
  const label = document.createElement('span');
  label.className = 'tools-label'; label.textContent = 'Volume';
  const input = document.createElement('input');
  input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01';
  input.value = state.meta[id].volume; input.className = 'vol';
  input.addEventListener('input', () => { state.meta[id].volume = parseFloat(input.value); saveState(); });
  row.append(label, input);
  return row;
}

function trackShell(id, title, accent, badge) {
  const m = state.meta[id];
  const wrap = document.createElement('section');
  wrap.className = 'track' + (m.expanded ? ' open' : '');
  wrap.dataset.track = id;
  wrap.style.setProperty('--accent', accent);

  const header = document.createElement('div');
  header.className = 'track-head';
  header.innerHTML = `
    <button class="chevron" aria-label="Déplier">${m.expanded ? '▾' : '▸'}</button>
    <span class="dot"></span>
    <span class="track-name">${title}</span>
    <span class="track-badge">${badge}</span>
    <button class="mute ${m.muted ? 'on' : ''}">${m.muted ? 'Muet' : 'Son'}</button>
  `;
  const toggle = () => { m.expanded = !m.expanded; saveState(); renderTracks(); };
  header.querySelector('.chevron').addEventListener('click', toggle);
  header.querySelector('.track-name').addEventListener('click', toggle);
  header.querySelector('.mute').addEventListener('click', (e) => {
    e.stopPropagation(); m.muted = !m.muted; saveState(); renderTracks();
  });
  wrap.appendChild(header);
  return wrap;
}

function renderDrumTrack() {
  const m = state.meta.drum;
  const p = editP();
  const hits = DRUM_LANES.reduce((n, l) => n + p.drum[l.id].filter(Boolean).length, 0);
  const wrap = trackShell('drum', 'Drum', '#ff5d73', `${hits} hits`);
  if (!m.expanded) return wrap;

  const body = document.createElement('div');
  body.className = 'track-body';
  body.appendChild(volumeControl('drum'));

  const grid = document.createElement('div');
  grid.className = 'grid drum-grid';
  for (const lane of DRUM_LANES) {
    const row = document.createElement('div');
    row.className = 'grid-row';
    const label = document.createElement('div');
    label.className = 'row-label'; label.textContent = lane.label;
    row.appendChild(label);

    const cells = document.createElement('div');
    cells.className = 'cells';
    cells.style.setProperty('--steps', state.steps);
    for (let s = 0; s < state.steps; s++) {
      const cell = document.createElement('button');
      cell.className = 'cell' + beatClass(s) + (p.drum[lane.id][s] ? ' active' : '');
      cell.dataset.step = s;
      cell.addEventListener('click', () => {
        p.drum[lane.id][s] = !p.drum[lane.id][s];
        cell.classList.toggle('active', p.drum[lane.id][s]);
        if (p.drum[lane.id][s]) engine.preview({ kind: lane.kind, gain: lane.gain * m.volume });
        saveState(); updateBadge('drum');
      });
      cells.appendChild(cell);
    }
    row.appendChild(cells);
    grid.appendChild(row);
  }
  body.appendChild(grid);
  wrap.appendChild(body);
  return wrap;
}

function renderPitchTrack(t) {
  const m = state.meta[t.id];
  const p = editP();
  const count = Object.keys(p[t.id].cells).filter(k => p[t.id].cells[k]).length;
  const wrap = trackShell(t.id, t.title, t.accent, `${count} notes`);
  if (!m.expanded) return wrap;

  const body = document.createElement('div');
  body.className = 'track-body';

  const tools = document.createElement('div');
  tools.className = 'track-tools';
  tools.innerHTML = `<span class="tools-label">Onde</span>`;
  for (const w of ['square', 'triangle', 'sawtooth']) {
    const b = document.createElement('button');
    b.className = 'pill' + (m.type === w ? ' on' : '');
    b.textContent = w === 'square' ? '⊓ Carré' : w === 'triangle' ? '△ Triangle' : '◺ Dent';
    b.addEventListener('click', () => { m.type = w; saveState(); renderTracks(); });
    tools.appendChild(b);
  }
  const sep = document.createElement('span');
  sep.className = 'tools-label sep'; sep.textContent = 'Accord';
  tools.appendChild(sep);
  for (const c of ['off', 'maj', 'min']) {
    const b = document.createElement('button');
    b.className = 'pill' + (m.chord === c ? ' on' : '');
    b.textContent = c === 'off' ? 'Note' : c === 'maj' ? 'Majeur' : 'Mineur';
    b.addEventListener('click', () => { m.chord = c; saveState(); renderTracks(); });
    tools.appendChild(b);
  }
  body.appendChild(tools);
  body.appendChild(volumeControl(t.id));

  const grid = document.createElement('div');
  grid.className = 'grid piano-grid';
  for (const midi of notesOf(t)) {
    const row = document.createElement('div');
    row.className = 'grid-row';
    const label = document.createElement('div');
    label.className = 'row-label note-label' + (isSharp(midi) ? ' sharp' : '');
    label.textContent = midiToName(midi);
    row.appendChild(label);

    const cells = document.createElement('div');
    cells.className = 'cells';
    cells.style.setProperty('--steps', state.steps);
    for (let s = 0; s < state.steps; s++) {
      const key = `${midi}:${s}`;
      const cell = document.createElement('button');
      cell.className = 'cell' + beatClass(s) + (isSharp(midi) ? ' sharp' : '') + (p[t.id].cells[key] ? ' active' : '');
      cell.dataset.step = s;
      cell.addEventListener('click', () => togglePitch(t, midi, s));
      cells.appendChild(cell);
    }
    row.appendChild(cells);
    grid.appendChild(row);
  }
  body.appendChild(grid);
  wrap.appendChild(body);
  return wrap;
}

function togglePitch(t, rootMidi, step) {
  const m = state.meta[t.id];
  const cells = editP()[t.id].cells;
  const shape = CHORDS[m.chord];
  const g = t.base * m.volume;

  if (!shape) {
    const key = `${rootMidi}:${step}`;
    if (cells[key]) delete cells[key];
    else {
      cells[key] = true;
      engine.preview({ kind: 'tone', freq: midiToFreq(rootMidi), dur: previewDur(), gain: g, type: m.type });
    }
  } else {
    const notes = shape.map(o => rootMidi + o).filter(n => n >= t.lo && n <= t.hi);
    const rootKey = `${rootMidi}:${step}`;
    if (cells[rootKey]) {
      for (const n of notes) delete cells[`${n}:${step}`];
    } else {
      for (const n of notes) cells[`${n}:${step}`] = true;
      for (const n of notes) engine.preview({ kind: 'tone', freq: midiToFreq(n), dur: previewDur(), gain: g * 0.8, type: m.type });
    }
  }
  saveState();
  renderTracks();
}

function updateBadge(id) {
  const el = tracksEl.querySelector(`[data-track="${id}"] .track-badge`);
  if (!el) return;
  const p = editP();
  if (id === 'drum') {
    el.textContent = `${DRUM_LANES.reduce((n, l) => n + p.drum[l.id].filter(Boolean).length, 0)} hits`;
  } else {
    el.textContent = `${Object.keys(p[id].cells).filter(k => p[id].cells[k]).length} notes`;
  }
}

// ============================================================================
// Playhead + playing-pattern highlight
// ============================================================================
let lastStep = -1;
engine.onStepDraw = (step) => {
  if (step === lastStep) return;
  tracksEl.querySelectorAll('.cell.playhead').forEach(c => c.classList.remove('playhead'));
  if (step >= 0) tracksEl.querySelectorAll(`.cells .cell[data-step="${step}"]`).forEach(c => c.classList.add('playhead'));
  lastStep = step;
};
engine.onPatternDraw = (idx) => { playingPattern = idx; renderSong(); };

// ============================================================================
// Transport
// ============================================================================
const playBtn = document.getElementById('play');
const bpmInput = document.getElementById('bpm');
const bpmVal = document.getElementById('bpm-val');
const stepsSel = document.getElementById('steps');
const clearBtn = document.getElementById('clear');

function syncTransportUI() {
  bpmInput.value = state.bpm;
  bpmVal.textContent = state.bpm;
  stepsSel.value = String(state.steps);
  engine.setBpm(state.bpm);
  engine.setSteps(state.steps);
  engine.setChain(state.chain);
}

playBtn.addEventListener('click', () => {
  engine.resume();
  if (engine.isPlaying) {
    engine.stop();
    playBtn.classList.remove('playing'); playBtn.textContent = '▶';
  } else {
    engine.setChain(state.chain);
    engine.start();
    playBtn.classList.add('playing'); playBtn.textContent = '■';
  }
});

bpmInput.addEventListener('input', () => {
  state.bpm = parseInt(bpmInput.value, 10);
  bpmVal.textContent = state.bpm;
  engine.setBpm(state.bpm);
  saveState();
});

stepsSel.addEventListener('change', () => {
  state.steps = parseInt(stepsSel.value, 10);
  resizeAll(state.steps);
  engine.setSteps(state.steps);
  saveState(); renderTracks();
});

clearBtn.addEventListener('click', () => {
  if (!confirm(`Effacer le motif ${patternLetter(state.editPattern)} ?`)) return;
  state.patterns[state.editPattern] = emptyPattern(state.steps);
  saveState(); renderTracks();
});

for (const opt of STEP_OPTIONS) {
  const o = document.createElement('option');
  o.value = String(opt); o.textContent = `${opt} pas`;
  stepsSel.appendChild(o);
}

// ============================================================================
// Toast
// ============================================================================
let toastTimer = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ============================================================================
// Boot
// ============================================================================
function renderAll() { renderSong(); renderTracks(); }

syncTransportUI();
renderAll();

function firstGestureUnlock() {
  engine.resume();
  document.removeEventListener('touchend', firstGestureUnlock);
  document.removeEventListener('pointerdown', firstGestureUnlock);
}
document.addEventListener('touchend', firstGestureUnlock, { once: true });
document.addEventListener('pointerdown', firstGestureUnlock, { once: true });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
