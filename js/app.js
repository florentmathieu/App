import { ChiptuneEngine, midiToFreq, midiToName, isSharp } from './audio.js';

// ============================================================================
// Configuration
// ============================================================================
const DRUM_LANES = [
  { id: 'kick',  label: 'Kick',  kind: 'kick',  gain: 1.0 },
  { id: 'snare', label: 'Snare', kind: 'snare', gain: 0.9 },
  { id: 'hat',   label: 'Hi-hat', kind: 'hat',  gain: 0.7 },
];

// Pitch ranges (MIDI). Low octaves for bass, higher for lead. Top to bottom in
// the piano roll = high to low pitch.
const BASS_RANGE = range(36, 55); // C2 .. G3
const LEAD_RANGE = range(57, 79); // A3 .. G5

function range(lo, hi) {
  const a = [];
  for (let m = hi; m >= lo; m--) a.push(m); // descending => top row highest
  return a;
}

const STEP_OPTIONS = [8, 16, 32];
const STORAGE_KEY = 'chiptune-mvp-v1';

// ============================================================================
// State
// ============================================================================
const engine = new ChiptuneEngine();

let state = loadState() || defaultState();

function defaultState() {
  return {
    bpm: 120,
    steps: 16,
    tracks: {
      drum: { expanded: true,  muted: false, lanes: emptyDrum(16) },
      bass: { expanded: false, muted: false, type: 'triangle', cells: {} }, // key `${midi}:${step}` => true
      lead: { expanded: false, muted: false, type: 'square',   cells: {} },
    },
  };
}

function emptyDrum(steps) {
  const o = {};
  for (const lane of DRUM_LANES) o[lane.id] = new Array(steps).fill(false);
  return o;
}

// Resize drum arrays when step count changes, preserving existing hits.
function resizeDrum(steps) {
  const d = state.tracks.drum.lanes;
  for (const lane of DRUM_LANES) {
    const old = d[lane.id] || [];
    const next = new Array(steps).fill(false);
    for (let i = 0; i < Math.min(steps, old.length); i++) next[i] = old[i];
    d[lane.id] = next;
  }
  // Drop pitched cells that fall outside the new step count.
  for (const t of ['bass', 'lead']) {
    const cells = state.tracks[t].cells;
    for (const key of Object.keys(cells)) {
      const step = parseInt(key.split(':')[1], 10);
      if (step >= steps) delete cells[key];
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
    if (!s.tracks || !s.tracks.drum) return null;
    return s;
  } catch (e) { return null; }
}

// ============================================================================
// Sequencer data -> voices for a given step
// ============================================================================
engine.stepProvider = (step) => {
  const voices = [];
  const secPerStep = 60.0 / state.bpm / (state.steps / 4);

  const drum = state.tracks.drum;
  if (!drum.muted) {
    for (const lane of DRUM_LANES) {
      if (drum.lanes[lane.id][step]) {
        voices.push({ kind: lane.kind, gain: lane.gain });
      }
    }
  }

  for (const tid of ['bass', 'lead']) {
    const t = state.tracks[tid];
    if (t.muted) continue;
    const dur = secPerStep * 0.9;
    for (const key of Object.keys(t.cells)) {
      const [midi, s] = key.split(':').map(Number);
      if (s === step && t.cells[key]) {
        voices.push({
          kind: 'tone',
          freq: midiToFreq(midi),
          dur,
          gain: tid === 'bass' ? 0.45 : 0.4,
          type: t.type,
        });
      }
    }
  }
  return voices;
};

// ============================================================================
// Rendering
// ============================================================================
const tracksEl = document.getElementById('tracks');

function render() {
  tracksEl.innerHTML = '';
  tracksEl.appendChild(renderDrumTrack());
  tracksEl.appendChild(renderPitchTrack('bass', 'Bass', BASS_RANGE));
  tracksEl.appendChild(renderPitchTrack('lead', 'Lead', LEAD_RANGE));
  highlightStep(engine.currentStep && engine.isPlaying ? engine.currentStep : -1);
}

function beatClass(step) {
  return step % 4 === 0 ? ' beat' : '';
}

function trackShell(id, title, accent, badge) {
  const t = state.tracks[id];
  const wrap = document.createElement('section');
  wrap.className = 'track' + (t.expanded ? ' open' : '');
  wrap.dataset.track = id;
  wrap.style.setProperty('--accent', accent);

  const header = document.createElement('div');
  header.className = 'track-head';
  header.innerHTML = `
    <button class="chevron" aria-label="Déplier">${t.expanded ? '▾' : '▸'}</button>
    <span class="dot"></span>
    <span class="track-name">${title}</span>
    <span class="track-badge">${badge}</span>
    <button class="mute ${t.muted ? 'on' : ''}">${t.muted ? 'Muet' : 'Son'}</button>
  `;
  header.querySelector('.chevron').addEventListener('click', () => {
    t.expanded = !t.expanded; saveState(); render();
  });
  header.querySelector('.track-name').addEventListener('click', () => {
    t.expanded = !t.expanded; saveState(); render();
  });
  header.querySelector('.mute').addEventListener('click', (e) => {
    e.stopPropagation(); t.muted = !t.muted; saveState(); render();
  });
  wrap.appendChild(header);
  return wrap;
}

function renderDrumTrack() {
  const t = state.tracks.drum;
  const hits = DRUM_LANES.reduce((n, l) => n + t.lanes[l.id].filter(Boolean).length, 0);
  const wrap = trackShell('drum', 'Drum', '#ff5d73', `${hits} hits`);
  if (!t.expanded) return wrap;

  const body = document.createElement('div');
  body.className = 'track-body';
  const grid = document.createElement('div');
  grid.className = 'grid drum-grid';
  grid.style.setProperty('--steps', state.steps);

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
      cell.className = 'cell' + beatClass(s) + (t.lanes[lane.id][s] ? ' active' : '');
      cell.dataset.step = s;
      cell.addEventListener('click', () => {
        t.lanes[lane.id][s] = !t.lanes[lane.id][s];
        cell.classList.toggle('active', t.lanes[lane.id][s]);
        if (t.lanes[lane.id][s]) engine.preview({ kind: lane.kind, gain: lane.gain });
        saveState();
        updateBadge('drum');
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

function renderPitchTrack(id, title, notes) {
  const t = state.tracks[id];
  const count = Object.keys(t.cells).filter(k => t.cells[k]).length;
  const wrap = trackShell(id, title, id === 'bass' ? '#4fc3f7' : '#b388ff', `${count} notes`);
  if (!t.expanded) return wrap;

  const body = document.createElement('div');
  body.className = 'track-body';

  // Waveform selector
  const tools = document.createElement('div');
  tools.className = 'track-tools';
  tools.innerHTML = `<span class="tools-label">Onde</span>`;
  for (const w of ['square', 'triangle', 'sawtooth']) {
    const b = document.createElement('button');
    b.className = 'wave' + (t.type === w ? ' on' : '');
    b.textContent = w === 'square' ? '⊓ Carré' : w === 'triangle' ? '△ Triangle' : '◺ Dent';
    b.addEventListener('click', () => { t.type = w; saveState(); render(); });
    tools.appendChild(b);
  }
  body.appendChild(tools);

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
      cell.className = 'cell' + beatClass(s) + (isSharp(midi) ? ' sharp' : '') + (t.cells[key] ? ' active' : '');
      cell.dataset.step = s;
      cell.addEventListener('click', () => {
        t.cells[key] = !t.cells[key];
        cell.classList.toggle('active', t.cells[key]);
        if (t.cells[key]) {
          const dur = 60.0 / state.bpm / (state.steps / 4) * 0.9;
          engine.preview({ kind: 'tone', freq: midiToFreq(midi), dur, gain: 0.4, type: t.type });
        } else {
          delete t.cells[key];
        }
        saveState();
        updateBadge(id);
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

function updateBadge(id) {
  const wrap = tracksEl.querySelector(`[data-track="${id}"] .track-badge`);
  if (!wrap) return;
  if (id === 'drum') {
    const t = state.tracks.drum;
    const hits = DRUM_LANES.reduce((n, l) => n + t.lanes[l.id].filter(Boolean).length, 0);
    wrap.textContent = `${hits} hits`;
  } else {
    const t = state.tracks[id];
    const count = Object.keys(t.cells).filter(k => t.cells[k]).length;
    wrap.textContent = `${count} notes`;
  }
}

// Playhead highlight
let lastStep = -1;
function highlightStep(step) {
  if (step === lastStep) return;
  tracksEl.querySelectorAll('.cell.playhead').forEach(c => c.classList.remove('playhead'));
  if (step >= 0) {
    tracksEl.querySelectorAll(`.cells .cell[data-step="${step}"]`).forEach(c => c.classList.add('playhead'));
  }
  lastStep = step;
}
engine.onStepDraw = highlightStep;

// ============================================================================
// Transport controls
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
}

playBtn.addEventListener('click', () => {
  engine.resume();
  if (engine.isPlaying) {
    engine.stop();
    playBtn.classList.remove('playing');
    playBtn.textContent = '▶';
  } else {
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
  resizeDrum(state.steps);
  engine.setSteps(state.steps);
  saveState();
  render();
});

clearBtn.addEventListener('click', () => {
  if (!confirm('Effacer toute la composition ?')) return;
  const steps = state.steps;
  state.tracks.drum.lanes = emptyDrum(steps);
  state.tracks.bass.cells = {};
  state.tracks.lead.cells = {};
  saveState();
  render();
});

// Populate the step selector
for (const opt of STEP_OPTIONS) {
  const o = document.createElement('option');
  o.value = String(opt); o.textContent = `${opt} pas`;
  stepsSel.appendChild(o);
}

// ============================================================================
// Boot
// ============================================================================
syncTransportUI();
render();

// Register service worker for offline / installable PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
