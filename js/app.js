import { ChiptuneEngine, midiToFreq, midiToName, isSharp } from './audio.js';

// ============================================================================
// Configuration
// ============================================================================
const DRUM_LANES = [
  { id: 'kick',  label: 'Kick',  kind: 'kick',  gain: 1.0 },
  { id: 'snare', label: 'Snare', kind: 'snare', gain: 0.9 },
  { id: 'hat',   label: 'Hi-hat', kind: 'hat',  gain: 0.7 },
];

// Pitch ranges (MIDI), top row = highest pitch.
const BASS_RANGE = range(36, 55); // C2 .. G3
const LEAD_RANGE = range(57, 79); // A3 .. G5
const RANGE = { bass: BASS_RANGE, lead: LEAD_RANGE };

function range(lo, hi) {
  const a = [];
  for (let m = hi; m >= lo; m--) a.push(m);
  return a;
}
function rangeBounds(notes) {
  return { min: notes[notes.length - 1], max: notes[0] };
}

// Chord shapes (semitone offsets from the root).
const CHORDS = {
  off: null,
  maj: [0, 4, 7],
  min: [0, 3, 7],
};

const STEP_OPTIONS = [8, 16, 32];
const STORAGE_KEY = 'chiptune-mvp-v2';

// ============================================================================
// State
// ============================================================================
const engine = new ChiptuneEngine();
let state = loadState() || defaultState();
let playingPattern = -1; // pattern index currently sounding (-1 = stopped)

function defaultState() {
  return {
    bpm: 120,
    steps: 16,
    meta: {
      drum: { expanded: true,  muted: false },
      bass: { expanded: false, muted: false, type: 'triangle', chord: 'off' },
      lead: { expanded: false, muted: false, type: 'square',   chord: 'off' },
    },
    patterns: [emptyPattern(16)],
    editPattern: 0,
    chain: [0],
  };
}

function emptyPattern(steps) {
  const drum = {};
  for (const lane of DRUM_LANES) drum[lane.id] = new Array(steps).fill(false);
  return { drum, bass: { cells: {} }, lead: { cells: {} } };
}

function editP() { return state.patterns[state.editPattern]; }
function patternLetter(i) { return String.fromCharCode(65 + i); }

// Resize every pattern's grids when the step count changes.
function resizeAll(steps) {
  for (const p of state.patterns) {
    for (const lane of DRUM_LANES) {
      const old = p.drum[lane.id] || [];
      const next = new Array(steps).fill(false);
      for (let i = 0; i < Math.min(steps, old.length); i++) next[i] = old[i];
      p.drum[lane.id] = next;
    }
    for (const t of ['bass', 'lead']) {
      const cells = p[t].cells;
      for (const key of Object.keys(cells)) {
        const step = parseInt(key.split(':')[1], 10);
        if (step >= steps) delete cells[key];
      }
    }
  }
}

// ============================================================================
// Persistence
// ============================================================================
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.patterns || !s.patterns.length || !s.meta) return null;
    return s;
  } catch (e) { return null; }
}

// ============================================================================
// Sequencer data -> voices for a given step in a given pattern
// ============================================================================
engine.stepProvider = (step, patternIndex) => {
  const p = state.patterns[patternIndex];
  if (!p) return [];
  const voices = [];
  const secPerStep = 60.0 / state.bpm / (state.steps / 4);

  if (!state.meta.drum.muted) {
    for (const lane of DRUM_LANES) {
      if (p.drum[lane.id][step]) voices.push({ kind: lane.kind, gain: lane.gain });
    }
  }

  for (const tid of ['bass', 'lead']) {
    if (state.meta[tid].muted) continue;
    const dur = secPerStep * 0.9;
    const cells = p[tid].cells;
    for (const key of Object.keys(cells)) {
      const [midi, s] = key.split(':').map(Number);
      if (s === step && cells[key]) {
        voices.push({
          kind: 'tone',
          freq: midiToFreq(midi),
          dur,
          gain: tid === 'bass' ? 0.45 : 0.4,
          type: state.meta[tid].type,
        });
      }
    }
  }
  return voices;
};

// ============================================================================
// Song panel: patterns + chain
// ============================================================================
const songEl = document.getElementById('song');

function renderSong() {
  songEl.innerHTML = '';

  // --- Patterns row ---
  const pRow = document.createElement('div');
  pRow.className = 'song-row';
  pRow.innerHTML = `<span class="song-label">Motifs</span>`;
  const pChips = document.createElement('div');
  pChips.className = 'chips';
  state.patterns.forEach((_, i) => {
    const chip = document.createElement('button');
    chip.className = 'chip pat'
      + (i === state.editPattern ? ' editing' : '')
      + (i === playingPattern ? ' playing' : '');
    chip.textContent = patternLetter(i);
    chip.addEventListener('click', () => { state.editPattern = i; saveState(); renderAll(); });
    pChips.appendChild(chip);
  });
  pRow.appendChild(pChips);

  const pTools = document.createElement('div');
  pTools.className = 'song-tools';
  pTools.appendChild(iconBtn('＋', 'Nouveau motif', () => {
    state.patterns.push(emptyPattern(state.steps));
    state.editPattern = state.patterns.length - 1;
    saveState(); renderAll();
  }));
  pTools.appendChild(iconBtn('⧉', 'Dupliquer', () => {
    const copy = JSON.parse(JSON.stringify(editP()));
    state.patterns.splice(state.editPattern + 1, 0, copy);
    state.editPattern += 1;
    saveState(); renderAll();
  }));
  pTools.appendChild(iconBtn('🗑', 'Supprimer', () => {
    if (state.patterns.length <= 1) return;
    const removed = state.editPattern;
    state.patterns.splice(removed, 1);
    // Fix up chain references.
    state.chain = state.chain
      .filter(idx => idx !== removed)
      .map(idx => (idx > removed ? idx - 1 : idx));
    if (!state.chain.length) state.chain = [0];
    if (state.editPattern >= state.patterns.length) state.editPattern = state.patterns.length - 1;
    engine.setChain(state.chain);
    saveState(); renderAll();
  }, state.patterns.length <= 1));
  pRow.appendChild(pTools);
  songEl.appendChild(pRow);

  // --- Chain row ---
  const cRow = document.createElement('div');
  cRow.className = 'song-row';
  cRow.innerHTML = `<span class="song-label">Chaîne</span>`;
  const cChips = document.createElement('div');
  cChips.className = 'chips chain';
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
    cChips.appendChild(chip);
  });
  cRow.appendChild(cChips);

  const cTools = document.createElement('div');
  cTools.className = 'song-tools';
  cTools.appendChild(iconBtn(`＋ ${patternLetter(state.editPattern)}`, 'Ajouter à la chaîne', () => {
    state.chain.push(state.editPattern);
    engine.setChain(state.chain);
    saveState(); renderSong();
  }, false, 'wide'));
  cRow.appendChild(cTools);
  songEl.appendChild(cRow);
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
// Tracks rendering
// ============================================================================
const tracksEl = document.getElementById('tracks');

function renderTracks() {
  tracksEl.innerHTML = '';
  tracksEl.appendChild(renderDrumTrack());
  tracksEl.appendChild(renderPitchTrack('bass', 'Bass', BASS_RANGE, '#4fc3f7'));
  tracksEl.appendChild(renderPitchTrack('lead', 'Lead', LEAD_RANGE, '#b388ff'));
  lastStep = -1;
}

function beatClass(step) { return step % 4 === 0 ? ' beat' : ''; }

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
  const grid = document.createElement('div');
  grid.className = 'grid drum-grid';

  for (const lane of DRUM_LANES) {
    const row = document.createElement('div');
    row.className = 'grid-row';
    const label = document.createElement('div');
    label.className = 'row-label';
    label.textContent = lane.label;
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
        if (p.drum[lane.id][s]) engine.preview({ kind: lane.kind, gain: lane.gain });
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

function renderPitchTrack(id, title, notes, accent) {
  const m = state.meta[id];
  const p = editP();
  const count = Object.keys(p[id].cells).filter(k => p[id].cells[k]).length;
  const wrap = trackShell(id, title, accent, `${count} notes`);
  if (!m.expanded) return wrap;

  const body = document.createElement('div');
  body.className = 'track-body';

  // Tools: waveform + chord brush
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

  const { min, max } = rangeBounds(notes);
  const grid = document.createElement('div');
  grid.className = 'grid piano-grid';

  for (const midi of notes) {
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
      cell.className = 'cell' + beatClass(s) + (isSharp(midi) ? ' sharp' : '') + (p[id].cells[key] ? ' active' : '');
      cell.dataset.step = s;
      cell.addEventListener('click', () => {
        togglePitch(id, midi, s, min, max);
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

// Toggle a single note, or a whole chord when a chord brush is active.
function togglePitch(id, rootMidi, step, min, max) {
  const m = state.meta[id];
  const cells = editP()[id].cells;
  const shape = CHORDS[m.chord];

  if (!shape) {
    const key = `${rootMidi}:${step}`;
    if (cells[key]) { delete cells[key]; }
    else {
      cells[key] = true;
      engine.preview({ kind: 'tone', freq: midiToFreq(rootMidi), dur: previewDur(), gain: 0.4, type: m.type });
    }
  } else {
    const notes = shape.map(off => rootMidi + off).filter(n => n >= min && n <= max);
    const rootKey = `${rootMidi}:${step}`;
    if (cells[rootKey]) {
      for (const n of notes) delete cells[`${n}:${step}`];
    } else {
      for (const n of notes) cells[`${n}:${step}`] = true;
      for (const n of notes) {
        engine.preview({ kind: 'tone', freq: midiToFreq(n), dur: previewDur(), gain: 0.32, type: m.type });
      }
    }
  }
  saveState();
  // Re-render this track so chord notes appear/disappear together.
  renderTracks();
}

function previewDur() { return 60.0 / state.bpm / (state.steps / 4) * 0.9; }

function updateBadge(id) {
  const el = tracksEl.querySelector(`[data-track="${id}"] .track-badge`);
  if (!el) return;
  const p = editP();
  if (id === 'drum') {
    const hits = DRUM_LANES.reduce((n, l) => n + p.drum[l.id].filter(Boolean).length, 0);
    el.textContent = `${hits} hits`;
  } else {
    const count = Object.keys(p[id].cells).filter(k => p[id].cells[k]).length;
    el.textContent = `${count} notes`;
  }
}

// ============================================================================
// Playhead + playing-pattern highlight
// ============================================================================
let lastStep = -1;
engine.onStepDraw = (step) => {
  if (step === lastStep) return;
  tracksEl.querySelectorAll('.cell.playhead').forEach(c => c.classList.remove('playhead'));
  if (step >= 0) {
    tracksEl.querySelectorAll(`.cells .cell[data-step="${step}"]`).forEach(c => c.classList.add('playhead'));
  }
  lastStep = step;
};
engine.onPatternDraw = (idx) => {
  playingPattern = idx;
  renderSong();
};

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
    playBtn.classList.remove('playing');
    playBtn.textContent = '▶';
  } else {
    engine.setChain(state.chain);
    engine.start();
    playBtn.classList.add('playing');
    playBtn.textContent = '■';
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
// Boot
// ============================================================================
function renderAll() { renderSong(); renderTracks(); }

syncTransportUI();
renderAll();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
