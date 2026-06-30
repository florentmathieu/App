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

// General MIDI mapping for export.
const DRUM_MIDI = { kick: 36, snare: 38, hat: 42, openhat: 46, clap: 39, tom: 45 };
const MIDI_PROGRAM = { bass: 38, lead: 80, lead2: 81 }; // synth bass, square lead, saw lead

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
let playingPos = -1;
let loopSection = false; // when true, playback loops only the edit pattern

function currentChain() { return loopSection ? [state.editPattern] : state.chain; }

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
  s.meta.drum = Object.assign({ expanded: true, muted: false, solo: false, volume: 0.9 }, s.meta.drum || {});
  for (const t of PITCHED_TRACKS) {
    s.meta[t.id] = Object.assign(
      { expanded: false, muted: false, solo: false, type: t.defType, chord: 'off', volume: t.vol,
        duty: 0.5, arp: 'off', arpRate: 4 },
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
// Sequencer data -> voices (volume + mute/solo baked in here)
// ============================================================================
const ALL_TRACK_IDS = ['drum', ...PITCHED_TRACKS.map(t => t.id)];
let exporting = false; // solo affects live monitoring only, not exports
function anySolo() { return ALL_TRACK_IDS.some(id => state.meta[id].solo); }
function isAudible(id) {
  const m = state.meta[id];
  if (m.muted) return false;
  if (!exporting && anySolo() && !m.solo) return false;
  return true;
}

engine.stepProvider = (step, patternIndex) => {
  const p = state.patterns[patternIndex];
  if (!p) return [];
  const voices = [];
  const secPerStep = 60.0 / state.bpm / (state.steps / 4);
  const dur = secPerStep * 0.9;

  const dm = state.meta.drum;
  if (isAudible('drum')) {
    for (const lane of DRUM_LANES) {
      if (p.drum[lane.id] && p.drum[lane.id][step]) {
        voices.push({ kind: lane.kind, gain: lane.gain * dm.volume });
      }
    }
  }
  for (const t of PITCHED_TRACKS) {
    const m = state.meta[t.id];
    if (!isAudible(t.id)) continue;
    const g = t.base * m.volume;
    const cells = p[t.id].cells;
    const notes = [];
    for (const key of Object.keys(cells)) {
      if (!cells[key]) continue;
      const [midi, s] = key.split(':').map(Number);
      if (s === step) notes.push(midi);
    }
    if (!notes.length) continue;

    if (m.arp && m.arp !== 'off') {
      notes.sort((a, b) => a - b);
      const order = arpOrder(notes, m.arp);
      const div = Math.max(2, m.arpRate || 4);
      const sub = secPerStep / div;
      for (let i = 0; i < div; i++) {
        const midi = order[i % order.length];
        voices.push({ kind: 'tone', freq: midiToFreq(midi), dur: sub * 0.9, gain: g, type: m.type, duty: m.duty, offset: i * sub });
      }
    } else {
      for (const midi of notes) {
        // Sustain: a run of adjacent active cells on the same row = one held
        // note. Only trigger at the run's start; skip continuations.
        if (step > 0 && cells[`${midi}:${step - 1}`]) continue;
        let len = 1;
        while (step + len < state.steps && cells[`${midi}:${step + len}`]) len++;
        voices.push({ kind: 'tone', freq: midiToFreq(midi), dur: secPerStep * len * 0.95, gain: g, type: m.type, duty: m.duty });
      }
    }
  }
  return voices;
};

function arpOrder(notes, mode) {
  if (mode === 'down') return notes.slice().reverse();
  if (mode === 'updown') {
    const up = notes.slice();
    const down = notes.slice().reverse().slice(1, -1); // avoid repeating the endpoints
    return down.length ? up.concat(down) : up;
  }
  return notes.slice(); // up
}

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
  tools.appendChild(iconBtn('✨', 'Génération auto', openGenerateModal));
  tools.appendChild(iconBtn('🎹', 'Clavier MIDI', openMidiModal));
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
    chip.addEventListener('click', () => {
      state.editPattern = i;
      if (loopSection && engine.isPlaying) engine.setChain(currentChain());
      saveState(); renderAll();
    });
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
    chip.className = 'chip slot' + (!loopSection && pos === playingPos ? ' playing' : '');
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
  tools.appendChild(iconBtn('⬇ MIDI', 'Exporter en MIDI', exportMidi, false, 'wide'));
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
  exporting = true; // ignore solo when bouncing
  try {
    const blob = fmt === 'mp3' ? await engine.renderMp3(160) : await engine.renderWav();
    downloadBlob(blob, `${safeName()}.${fmt}`);
    toast(`Export ${fmt.toUpperCase()} prêt`);
  } catch (e) {
    alert('Export échoué : ' + (e && e.message ? e.message : e));
  } finally {
    exporting = false;
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

// ----- MIDI export (Standard MIDI File, format 1) -----
function exportMidi() {
  try {
    downloadBlob(buildMidiBlob(), `${safeName()}.mid`);
    toast('Export MIDI prêt');
  } catch (e) {
    alert('Export MIDI échoué : ' + (e && e.message ? e.message : e));
  }
}

function vlq(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
}
function clampVel(x) { return Math.max(1, Math.min(127, Math.round(x * 127))); }

function encodeTrack(events) {
  events = events.slice().sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out = [];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  out.push(0x00, 0xFF, 0x2F, 0x00); // end of track
  const len = out.length;
  return [0x4D, 0x54, 0x72, 0x6B, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...out];
}

function buildMidiBlob() {
  const PPQ = 480;
  const ticksPerStep = Math.round(PPQ / (state.steps / 4));
  const barTicks = state.steps * ticksPerStep;
  const chunks = [];

  // Track 0: tempo + time signature
  const tempo = Math.round(60000000 / state.bpm);
  const meta = [
    { tick: 0, order: 0, data: [0xFF, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
    { tick: 0, order: 1, data: [0xFF, 0x58, 0x04, 4, 2, 24, 8] },
  ];
  chunks.push(encodeTrack(meta));

  const nameEvt = (name) => {
    const b = [...name].map(c => c.charCodeAt(0) & 0x7f);
    return { tick: 0, order: -2, data: [0xFF, 0x03, b.length, ...b] };
  };

  // Drum track (GM channel 10 => index 9)
  {
    const ev = [nameEvt('Drum')];
    const dvol = state.meta.drum.volume;
    for (let cp = 0; cp < state.chain.length; cp++) {
      const p = state.patterns[state.chain[cp]];
      const start = cp * barTicks;
      for (const lane of DRUM_LANES) {
        const note = DRUM_MIDI[lane.id];
        const vel = clampVel(lane.gain * dvol);
        for (let s = 0; s < state.steps; s++) {
          if (!p.drum[lane.id][s]) continue;
          const on = start + s * ticksPerStep;
          ev.push({ tick: on, order: 1, data: [0x99, note, vel] });
          ev.push({ tick: on + Math.floor(ticksPerStep / 2), order: 0, data: [0x89, note, 0] });
        }
      }
    }
    chunks.push(encodeTrack(ev));
  }

  // Melodic tracks
  PITCHED_TRACKS.forEach((t, i) => {
    const chan = i % 16 === 9 ? 10 : i; // keep off the drum channel
    const m = state.meta[t.id];
    const vel = clampVel(m.volume);
    const ev = [nameEvt(t.title), { tick: 0, order: -1, data: [0xC0 | chan, MIDI_PROGRAM[t.id] || 80] }];
    for (let cp = 0; cp < state.chain.length; cp++) {
      const p = state.patterns[state.chain[cp]];
      const start = cp * barTicks;
      const cells = p[t.id].cells;
      const active = (midi, s) => !!cells[`${midi}:${s}`];
      if (m.arp && m.arp !== 'off') {
        const byStep = {};
        for (const k of Object.keys(cells)) {
          if (!cells[k]) continue;
          const [midi, s] = k.split(':').map(Number);
          (byStep[s] = byStep[s] || []).push(midi);
        }
        for (const s of Object.keys(byStep)) {
          const stepTick = start + Number(s) * ticksPerStep;
          const notes = byStep[s].sort((a, b) => a - b);
          const order = arpOrder(notes, m.arp);
          const div = Math.max(2, m.arpRate || 4);
          const sub = ticksPerStep / div;
          for (let j = 0; j < div; j++) {
            const note = order[j % order.length];
            ev.push({ tick: stepTick + Math.floor(j * sub), order: 1, data: [0x90 | chan, note, vel] });
            ev.push({ tick: stepTick + Math.floor((j + 1) * sub), order: 0, data: [0x80 | chan, note, 0] });
          }
        }
      } else {
        // Merge runs of adjacent same-pitch cells into sustained MIDI notes.
        const midis = new Set(Object.keys(cells).filter(k => cells[k]).map(k => +k.split(':')[0]));
        for (const midi of midis) {
          for (let s = 0; s < state.steps; s++) {
            if (!active(midi, s) || (s > 0 && active(midi, s - 1))) continue;
            let len = 1;
            while (s + len < state.steps && active(midi, s + len)) len++;
            ev.push({ tick: start + s * ticksPerStep, order: 1, data: [0x90 | chan, midi, vel] });
            ev.push({ tick: start + (s + len) * ticksPerStep, order: 0, data: [0x80 | chan, midi, 0] });
          }
        }
      }
    }
    chunks.push(encodeTrack(ev));
  });

  const ntrk = chunks.length;
  const header = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (ntrk >> 8) & 255, ntrk & 255, (PPQ >> 8) & 255, PPQ & 255];
  const all = header.concat(...chunks);
  return new Blob([new Uint8Array(all)], { type: 'audio/midi' });
}

// ============================================================================
// Auto-generation of coherent musical phrases
// ============================================================================
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  penta: [0, 3, 5, 7, 10],          // minor pentatonic
  hirajoshi: [0, 2, 3, 7, 8],       // japanese
  dorian: [0, 2, 3, 5, 7, 9, 10],   // medieval / folk
  phrygian: [0, 1, 3, 5, 7, 8, 10], // dark / dungeon
  lydian: [0, 2, 4, 6, 7, 9, 11],   // bright / dreamy
  wholetone: [0, 2, 4, 6, 8, 10],   // floating / space
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  pentaMajor: [0, 2, 4, 7, 9],      // bright / folk / western
};
// Chord progressions as scale-degree indices (valid for each scale's length).
const PROGS = {
  major: [[0, 4, 5, 3], [0, 3, 4, 4], [5, 3, 0, 4], [3, 4, 0, 0]],
  minor: [[0, 5, 2, 6], [0, 3, 4, 4], [0, 6, 5, 5], [0, 5, 6, 3]],
  penta: [[0, 3, 4, 0], [0, 0, 3, 4]],
  hirajoshi: [[0, 3, 4, 0], [0, 2, 4, 3], [0, 4, 2, 0]],
  dorian: [[0, 3, 4, 4], [0, 6, 3, 0], [0, 4, 5, 3]],
  phrygian: [[0, 1, 0, 5], [0, 6, 5, 0], [0, 5, 1, 0]],
  lydian: [[0, 4, 1, 0], [0, 1, 4, 4], [0, 3, 4, 0]],
  wholetone: [[0, 2, 4, 0], [0, 4, 2, 4], [0, 3, 5, 0]],
  harmonicMinor: [[0, 3, 4, 4], [0, 5, 4, 0], [0, 3, 6, 4]],
  pentaMajor: [[0, 3, 4, 0], [0, 4, 2, 3], [0, 2, 4, 0]],
};
const SCALE_LABELS = {
  major: 'majeur', minor: 'mineur', penta: 'penta', hirajoshi: 'hirajoshi',
  dorian: 'dorien', phrygian: 'phrygien', lydian: 'lydien',
  wholetone: 'tons entiers', harmonicMinor: 'min. harmonique', pentaMajor: 'penta majeur',
};

// Style presets: scale + tempo + density + per-track waveform/duty.
const STYLES = {
  standard:  { label: 'Standard',  scale: 'minor',     bpm: 120, density: 'normal', waves: { bass: { type: 'triangle' }, lead: { type: 'square', duty: 0.5 }, lead2: { type: 'square', duty: 0.25 } } },
  asiatique: { label: 'Asiatique', scale: 'hirajoshi', bpm: 96,  density: 'sparse', waves: { bass: { type: 'triangle' }, lead: { type: 'square', duty: 0.5 }, lead2: { type: 'triangle' } } },
  medieval:  { label: 'Médiéval',  scale: 'dorian',    bpm: 108, density: 'normal', waves: { bass: { type: 'triangle' }, lead: { type: 'square', duty: 0.5 }, lead2: { type: 'square', duty: 0.5 } } },
  spatial:   { label: 'Spatial',   scale: 'wholetone', bpm: 84,  density: 'sparse', waves: { bass: { type: 'sawtooth' }, lead: { type: 'sawtooth' }, lead2: { type: 'triangle' } } },
  heroique:  { label: 'Héroïque',  scale: 'major',     bpm: 140, density: 'dense',  waves: { bass: { type: 'triangle' }, lead: { type: 'square', duty: 0.25 }, lead2: { type: 'square', duty: 0.25 } } },
  donjon:    { label: 'Donjon',    scale: 'phrygian',  bpm: 92,  density: 'normal', waves: { bass: { type: 'triangle' }, lead: { type: 'square', duty: 0.125 }, lead2: { type: 'triangle' } } },
  lofi:      { label: 'Lo-fi',     scale: 'dorian',    bpm: 75,  density: 'sparse', waves: { bass: { type: 'triangle' }, lead: { type: 'triangle' }, lead2: { type: 'triangle' } } },
  dance:     { label: 'Dance',     scale: 'minor',     bpm: 128, density: 'dense',  waves: { bass: { type: 'sawtooth' }, lead: { type: 'square', duty: 0.25 }, lead2: { type: 'square', duty: 0.5 } } },
  western:   { label: 'Western',   scale: 'pentaMajor', bpm: 104, density: 'normal', waves: { bass: { type: 'triangle' }, lead: { type: 'square', duty: 0.5 }, lead2: { type: 'triangle' } } },
  horreur:   { label: 'Horreur',   scale: 'harmonicMinor', bpm: 66, density: 'sparse', waves: { bass: { type: 'triangle' }, lead: { type: 'square', duty: 0.125 }, lead2: { type: 'sawtooth' } } },
};

const ROOT_NAMES = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

// Song structures: a set of section patterns (with their own density +
// instrumentation) plus a chain arranging them into a form.
const SONG_FORMS = {
  verseChorus: {
    sections: [
      { label: 'Couplet', density: 'normal', tracks: { drum: 1, bass: 1, lead: 1, lead2: 0 } },
      { label: 'Refrain', density: 'dense',  tracks: { drum: 1, bass: 1, lead: 1, lead2: 1 } },
    ],
    chain: [0, 0, 1, 0, 1, 1],
  },
  full: {
    sections: [
      { label: 'Intro',   density: 'sparse', tracks: { drum: 1, bass: 1, lead: 0, lead2: 0 } },
      { label: 'Couplet', density: 'normal', tracks: { drum: 1, bass: 1, lead: 1, lead2: 0 } },
      { label: 'Refrain', density: 'dense',  tracks: { drum: 1, bass: 1, lead: 1, lead2: 1 } },
      { label: 'Pont',    density: 'normal', tracks: { drum: 1, bass: 1, lead: 0, lead2: 1 } },
    ],
    chain: [0, 1, 2, 1, 2, 3, 2],
  },
};

let genOpts = { scale: 'minor', root: null, density: 'normal', form: 'single', style: null, tracks: { drum: true, bass: true, lead: true, lead2: true } };

function applyStyle(id) {
  const st = STYLES[id];
  if (!st) return;
  genOpts.style = id;
  genOpts.scale = st.scale;
  genOpts.density = st.density;
  state.bpm = st.bpm;
  for (const [tid, w] of Object.entries(st.waves)) {
    if (!state.meta[tid]) continue;
    if (w.type) state.meta[tid].type = w.type;
    if (w.duty != null) state.meta[tid].duty = w.duty;
  }
  saveState();
  syncTransportUI();
  renderTracks();
  renderSong();
  toast('Style : ' + st.label);
}

const rand = (a) => a[Math.floor(Math.random() * a.length)];
function degToMidi(rootMidi, scale, degree) {
  const len = scale.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return rootMidi + oct * 12 + scale[idx];
}
function fitRange(m, lo, hi) { while (m < lo) m += 12; while (m > hi) m -= 12; return m; }
function keyLabel(rootPC, scale) {
  return `${ROOT_NAMES[rootPC]} ${SCALE_LABELS[scale] || scale}`;
}

// --- Rhythm template libraries (positions expressed in beats, 4 beats/bar) ---
const DRUM_KICK = [[0, 2], [0, 1, 2, 3], [0, 2, 2.5], [0, 0.75, 2, 2.5], [0, 2, 3.5], [0, 1.5, 2, 3.5]];
const DRUM_SNARE = [[1, 3], [1, 3, 3.5], [1, 2.75, 3], [3]];
const BASS_RHY = {
  sparse: [[0], [0, 2], [0, 2.5]],
  normal: [[0, 1, 2, 3], [0, 2, 2.5, 3], [0, 0.5, 2, 2.5], [0, 1.5, 2, 3.5]],
  dense:  [[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], [0, 1, 1.5, 2, 3, 3.5], [0, 0.5, 1, 2, 2.5, 3]],
};
const LEAD_RHY = {
  sparse: [[0, 1, 2, 3], [0, 1.5, 2.5], [0, 2, 3], [0, 0.5, 2]],
  normal: [[0, 0.5, 1, 2, 2.5, 3], [0, 0.75, 1.5, 2, 3, 3.5], [0, 1, 1.5, 2, 2.5, 3.5], [0, 0.5, 1.5, 2, 2.5, 3]],
  dense:  [[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], [0, 0.5, 0.75, 1, 1.5, 2, 2.5, 2.75, 3, 3.5]],
};

function beatsToSteps(beats, spb, steps) {
  const set = new Set();
  for (const b of beats) { const s = Math.round(b * spb); if (s >= 0 && s < steps) set.add(s); }
  return [...set].sort((a, b) => a - b);
}

// Fill one pattern object with a coherent phrase. ctx carries the shared key
// plus this section's density/tracks. Rhythms are picked from templates each
// call, so successive generations vary while staying in the same genre.
function fillPattern(p, ctx) {
  const { scaleArr, rootPC, prog, steps, spb, numChords, segLen, density, tracks } = ctx;
  const chordAt = (s) => prog[Math.min(numChords - 1, Math.floor(s / segLen))];

  if (tracks.drum) {
    for (const lane of DRUM_LANES) p.drum[lane.id] = new Array(steps).fill(false);
    const set = (lane, s) => { if (s >= 0 && s < steps) p.drum[lane][s] = true; };
    for (const s of beatsToSteps(rand(DRUM_KICK), spb, steps)) set('kick', s);
    for (const s of beatsToSteps(rand(DRUM_SNARE), spb, steps)) set('snare', s);
    // Hats: rate or off-beat variant, scaled by density.
    const rate = density === 'dense' ? Math.min(4, spb) : density === 'sparse' ? 1 : 2;
    let hats = [];
    if (Math.random() < 0.3) { for (let b = 0; b < 4; b++) hats.push(b + 0.5); }      // off-beat
    else { for (let b = 0; b < 4; b++) for (let k = 0; k < rate; k++) hats.push(b + k / rate); }
    for (const s of beatsToSteps(hats, spb, steps)) set('hat', s);
    // Optional ghost kick + end-of-bar fill for variety.
    if (density !== 'sparse' && Math.random() < 0.5) for (const s of beatsToSteps([rand([0.5, 1.5, 2.5])], spb, steps)) set('kick', s);
    if (Math.random() < 0.4) {
      const sub = density === 'dense' ? 4 : 2;
      for (let k = 0; k < sub; k++) { const st = Math.round((3 + k / sub) * spb); if (st < steps) set(rand(['tom', 'snare']), st); }
      if (density === 'dense') set('openhat', Math.min(steps - 1, Math.round(3.5 * spb)));
    }
  }

  if (tracks.bass) {
    state.meta.bass.arp = 'off';
    p.bass.cells = {};
    const { lo, hi } = PT.bass; const rootMidi = 36 + rootPC;
    for (const s of beatsToSteps(rand(BASS_RHY[density] || BASS_RHY.normal), spb, steps)) {
      const d = chordAt(s);
      const r = Math.random();
      let note;
      if (r > 0.86) note = fitRange(degToMidi(rootMidi, scaleArr, d) + 12, lo, hi); // octave pop
      else if (r > 0.74) note = fitRange(degToMidi(rootMidi, scaleArr, d + 4), lo, hi); // fifth
      else note = fitRange(degToMidi(rootMidi, scaleArr, d), lo, hi);                 // root
      p.bass.cells[`${note}:${s}`] = true;
    }
  }

  if (tracks.lead) {
    state.meta.lead.arp = 'off';
    p.lead.cells = {};
    const { lo, hi } = PT.lead; const rootMidi = 60 + rootPC;
    const onsets = beatsToSteps(rand(LEAD_RHY[density] || LEAD_RHY.normal), spb, steps);
    // A short melodic motif (interval deltas) repeated between beats, re-anchored
    // to a chord tone on each beat — gives intentional, varied phrases.
    const motif = Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => rand([-2, -1, -1, 1, 1, 2, 2, 3]));
    let deg = rand([0, 2, 4]), mi = 0;
    for (const s of onsets) {
      const d = chordAt(s);
      if (s % spb === 0) {
        const tones = [d, d + 2, d + 4];
        deg = tones.reduce((best, t) => Math.abs(t - deg) < Math.abs(best - deg) ? t : best, tones[0]);
        mi = 0;
      } else {
        deg += motif[mi % motif.length]; mi++;
      }
      p.lead.cells[`${fitRange(degToMidi(rootMidi, scaleArr, deg), lo, hi)}:${s}`] = true;
    }
  }

  if (tracks.lead2) {
    state.meta.lead2.arp = 'off';
    p.lead2.cells = {};
    const { lo, hi } = PT.lead2; const rootMidi = 60 + rootPC;
    const dir = rand(['up', 'down', 'updown']);
    const rate = density === 'dense' ? Math.min(4, spb) : density === 'sparse' ? 1 : 2;
    const gate = [];
    for (let b = 0; b < 4; b++) for (let k = 0; k < rate; k++) gate.push(b + k / rate);
    let i = 0;
    for (const s of beatsToSteps(gate, spb, steps)) {
      const d = chordAt(s);
      let seq = [d, d + 2, d + 4];
      if (dir === 'down') seq = [d + 4, d + 2, d];
      else if (dir === 'updown') seq = [d, d + 2, d + 4, d + 2];
      p.lead2.cells[`${fitRange(degToMidi(rootMidi, scaleArr, seq[i % seq.length]), lo, hi)}:${s}`] = true;
      i++;
    }
  }
}

function buildCtx(scale, density, tracks, rootPC) {
  const steps = state.steps;
  return {
    scaleArr: SCALES[scale] || SCALES.minor,
    rootPC,
    prog: rand(PROGS[scale] || PROGS.minor),
    steps,
    spb: Math.max(1, Math.floor(steps / 4)),
    numChords: steps >= 16 ? 4 : steps >= 8 ? 2 : 1,
    segLen: steps / (steps >= 16 ? 4 : steps >= 8 ? 2 : 1),
    density,
    tracks,
  };
}

// Single pattern into the current edit slot.
function generate(opts) {
  const rootPC = opts.root == null ? Math.floor(Math.random() * 12) : opts.root;
  fillPattern(editP(), buildCtx(opts.scale, opts.density, opts.tracks, rootPC));
  saveState(); syncTransportUI(); renderTracks(); renderSong();
  return keyLabel(rootPC, opts.scale);
}

// Whole song: several section patterns (shared key) + an arranged chain.
function generateSong(opts) {
  const form = SONG_FORMS[opts.form];
  const rootPC = opts.root == null ? Math.floor(Math.random() * 12) : opts.root;
  const patterns = [];
  for (const sec of form.sections) {
    const p = emptyPattern(state.steps);
    const tracks = {};
    for (const id of ['drum', 'bass', 'lead', 'lead2']) tracks[id] = !!sec.tracks[id] && !!opts.tracks[id];
    // No drums selected? Bring the melody in from the very start (otherwise a
    // drum-focused intro would be nearly empty).
    if (!opts.tracks.drum) {
      if (opts.tracks.bass) tracks.bass = true;
      if (opts.tracks.lead) tracks.lead = true;
    }
    // Never leave a section silent: fall back to any enabled melodic track.
    if (!tracks.drum && !tracks.bass && !tracks.lead && !tracks.lead2) {
      for (const id of ['bass', 'lead', 'lead2']) if (opts.tracks[id]) tracks[id] = true;
    }
    fillPattern(p, buildCtx(opts.scale, sec.density, tracks, rootPC));
    patterns.push(p);
  }
  state.patterns = patterns;
  // Show the richest section (e.g. the refrain) so what you see matches what
  // you hear — the intro can be empty of lead/arp.
  let best = 0, bestScore = -1;
  patterns.forEach((p, idx) => {
    let sc = 0;
    for (const l of DRUM_LANES) sc += (p.drum[l.id] || []).filter(Boolean).length;
    for (const t of PITCHED_TRACKS) sc += Object.values(p[t.id].cells).filter(Boolean).length;
    if (sc > bestScore) { bestScore = sc; best = idx; }
  });
  state.editPattern = best;
  state.chain = form.chain.filter(i => i < patterns.length);
  if (!state.chain.length) state.chain = [0];
  saveState(); syncTransportUI(); renderTracks(); renderSong();
  return keyLabel(rootPC, opts.scale);
}

function genPillGroup(label, options, get, set) {
  const row = document.createElement('div');
  row.className = 'track-tools';
  row.innerHTML = `<span class="tools-label">${label}</span>`;
  for (const [val, lbl] of options) {
    const b = document.createElement('button');
    b.className = 'pill' + (get() === val ? ' on' : '');
    b.textContent = lbl;
    b.addEventListener('click', () => {
      set(val);
      [...row.querySelectorAll('.pill')].forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    });
    row.appendChild(b);
  }
  return row;
}

function openGenerateModal() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const modal = document.createElement('div');
  modal.className = 'modal';
  const head = document.createElement('div');
  head.className = 'modal-head';
  head.innerHTML = `<h2>✨ Génération auto</h2>`;
  const close = document.createElement('button');
  close.className = 'modal-close'; close.textContent = '✕';
  close.addEventListener('click', () => overlay.remove());
  head.appendChild(close);
  modal.appendChild(head);

  const body = document.createElement('div');
  body.className = 'gen-body';

  // Style presets (apply scale/tempo/waveforms, then refresh the modal)
  const styleRow = document.createElement('div');
  styleRow.className = 'track-tools';
  styleRow.innerHTML = `<span class="tools-label">Style</span>`;
  for (const [id, st] of Object.entries(STYLES)) {
    const b = document.createElement('button');
    b.className = 'pill' + (genOpts.style === id ? ' on' : '');
    b.textContent = st.label;
    b.addEventListener('click', () => { applyStyle(id); overlay.remove(); openGenerateModal(); });
    styleRow.appendChild(b);
  }
  body.appendChild(styleRow);

  body.appendChild(genPillGroup('Structure',
    [['single', '1 motif'], ['verseChorus', 'Couplet/Refrain'], ['full', 'Morceau complet']],
    () => genOpts.form, v => genOpts.form = v));

  body.appendChild(genPillGroup('Gamme',
    [['major', 'Majeur'], ['minor', 'Mineur'], ['penta', 'Penta']],
    () => genOpts.scale, v => genOpts.scale = v));

  const rootRow = document.createElement('div');
  rootRow.className = 'track-tools';
  rootRow.innerHTML = `<span class="tools-label">Tonalité</span>`;
  const sel = document.createElement('select');
  sel.className = 'gen-sel';
  const optRand = document.createElement('option');
  optRand.value = ''; optRand.textContent = 'Aléatoire';
  sel.appendChild(optRand);
  ROOT_NAMES.forEach((n, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = n; sel.appendChild(o); });
  sel.value = genOpts.root == null ? '' : String(genOpts.root);
  sel.addEventListener('change', () => { genOpts.root = sel.value === '' ? null : parseInt(sel.value, 10); });
  rootRow.appendChild(sel);
  body.appendChild(rootRow);

  body.appendChild(genPillGroup('Densité',
    [['sparse', 'Clair'], ['normal', 'Normal'], ['dense', 'Dense']],
    () => genOpts.density, v => genOpts.density = v));

  const trkRow = document.createElement('div');
  trkRow.className = 'track-tools';
  trkRow.innerHTML = `<span class="tools-label">Pistes</span>`;
  for (const [id, lbl] of [['drum', 'Drum'], ['bass', 'Bass'], ['lead', 'Lead'], ['lead2', 'Lead 2']]) {
    const b = document.createElement('button');
    b.className = 'pill' + (genOpts.tracks[id] ? ' on' : '');
    b.textContent = lbl;
    b.addEventListener('click', () => { genOpts.tracks[id] = !genOpts.tracks[id]; b.classList.toggle('on', genOpts.tracks[id]); });
    trkRow.appendChild(b);
  }
  body.appendChild(trkRow);

  const note = document.createElement('p');
  note.className = 'gen-note';
  note.textContent = 'Génère dans le motif courant. Relance pour varier.';
  body.appendChild(note);
  modal.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  const gen = document.createElement('button');
  gen.className = 'song-btn wide';
  gen.textContent = '✨ Générer';
  gen.addEventListener('click', () => {
    if (!Object.values(genOpts.tracks).some(Boolean)) { alert('Sélectionne au moins une piste'); return; }
    let key;
    if (genOpts.form === 'single') {
      key = generate(genOpts);
    } else {
      if (!confirm('Générer un morceau complet ? Cela remplace tous les motifs et la chaîne actuels.')) return;
      key = generateSong(genOpts);
    }
    toast('Généré en ' + key);
  });
  foot.appendChild(gen);
  modal.appendChild(foot);

  // The "Pistes" row is an allow-list; in song mode the structure also decides
  // which instruments appear per section.

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ============================================================================
// Live MIDI keyboard input (Web MIDI API — not supported on iOS Safari)
// ============================================================================
let midiAccess = null;
let midiEnabled = false;
let midiTarget = 'lead';
let midiArmed = false;
let writeStep = 0;
let midiChordTimer = null;
let midiStatusEl = null;

function midiSupported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }

async function enableMidi() {
  if (!midiSupported()) return;
  engine.resume();
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    midiEnabled = true;
    bindMidiInputs();
    midiAccess.onstatechange = bindMidiInputs;
  } catch (e) {
    midiEnabled = false;
    if (midiStatusEl) midiStatusEl.textContent = 'Accès MIDI refusé : ' + (e.message || e);
  }
  updateMidiStatus();
}

function bindMidiInputs() {
  if (!midiAccess) return;
  for (const input of midiAccess.inputs.values()) input.onmidimessage = onMidiMessage;
  updateMidiStatus();
}

function midiDeviceNames() {
  if (!midiAccess) return [];
  return [...midiAccess.inputs.values()].map(i => i.name || 'MIDI');
}

function updateMidiStatus() {
  if (!midiStatusEl) return;
  if (!midiSupported()) { midiStatusEl.textContent = '⚠️ Web MIDI non supporté par ce navigateur (ex. Safari iPhone).'; return; }
  if (!midiEnabled) { midiStatusEl.textContent = 'MIDI non activé.'; return; }
  const names = midiDeviceNames();
  midiStatusEl.textContent = names.length ? '🎹 Connecté : ' + names.join(', ') : 'Activé — branche un clavier MIDI.';
}

function onMidiMessage(ev) {
  const [status, d1, d2] = ev.data;
  const cmd = status & 0xf0;
  if (cmd === 0x90 && d2 > 0) handleMidiNoteOn(d1, d2);
}

function handleMidiNoteOn(midiNote, velocity) {
  const t = PT[midiTarget];
  const m = state.meta[midiTarget];
  const note = fitRange(midiNote, t.lo, t.hi);
  const gain = t.base * m.volume * Math.max(0.3, velocity / 127);
  engine.preview({ kind: 'tone', freq: midiToFreq(note), dur: previewDur(), gain, type: m.type, duty: m.duty });

  if (!midiArmed) return;

  if (engine.isPlaying) {
    // Real-time overdub: quantize to the current playhead step of the edit pattern.
    const step = lastStep >= 0 ? lastStep : 0;
    editP()[midiTarget].cells[`${note}:${step}`] = true;
    saveState();
    markRecordedCell(midiTarget, note, step);
  } else {
    // Step entry: write at the cursor; chords (near-simultaneous notes) share it.
    editP()[midiTarget].cells[`${note}:${writeStep}`] = true;
    saveState();
    renderTracks();
    clearTimeout(midiChordTimer);
    midiChordTimer = setTimeout(() => { writeStep = (writeStep + 1) % state.steps; renderTracks(); }, 140);
  }
}

function markRecordedCell(trackId, midi, step) {
  const cell = tracksEl.querySelector(`[data-track="${trackId}"] .cell[data-step="${step}"][data-midi="${midi}"]`);
  if (cell) cell.classList.add('active');
}

function openMidiModal() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const modal = document.createElement('div');
  modal.className = 'modal';
  const head = document.createElement('div');
  head.className = 'modal-head';
  head.innerHTML = `<h2>🎹 Clavier MIDI</h2>`;
  const close = document.createElement('button');
  close.className = 'modal-close'; close.textContent = '✕';
  close.addEventListener('click', () => overlay.remove());
  head.appendChild(close);
  modal.appendChild(head);

  const body = document.createElement('div');
  body.className = 'gen-body';

  midiStatusEl = document.createElement('p');
  midiStatusEl.className = 'gen-note';
  body.appendChild(midiStatusEl);
  updateMidiStatus();

  if (midiSupported() && !midiEnabled) {
    const en = document.createElement('button');
    en.className = 'song-btn wide';
    en.textContent = 'Activer le MIDI';
    en.addEventListener('click', async () => { await enableMidi(); openMidiRefresh(); });
    body.appendChild(en);
  }

  // Target track
  body.appendChild(genPillGroup('Cible',
    [['bass', 'Bass'], ['lead', 'Lead'], ['lead2', 'Lead 2']],
    () => midiTarget, v => { midiTarget = v; renderTracks(); }));

  // Arm recording
  const armRow = document.createElement('div');
  armRow.className = 'track-tools';
  armRow.innerHTML = `<span class="tools-label">Enregistrer</span>`;
  const armBtn = document.createElement('button');
  armBtn.className = 'pill' + (midiArmed ? ' on' : '');
  armBtn.textContent = midiArmed ? '● Armé' : 'Désarmé';
  armBtn.addEventListener('click', () => {
    midiArmed = !midiArmed;
    armBtn.className = 'pill' + (midiArmed ? ' on' : '');
    armBtn.textContent = midiArmed ? '● Armé' : 'Désarmé';
    writeStep = 0;
    renderTracks();
  });
  armRow.appendChild(armBtn);
  body.appendChild(armRow);

  const note = document.createElement('p');
  note.className = 'gen-note';
  note.innerHTML = 'Joue : tu entends la piste cible.<br>Armé + <b>lecture</b> : enregistrement en boucle (quantisé au pas).<br>Armé + <b>à l\'arrêt</b> : saisie pas-à-pas (les accords vont sur le même pas).';
  body.appendChild(note);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Re-open helper after enabling (refresh the modal contents).
  function openMidiRefresh() { overlay.remove(); openMidiModal(); }
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
    <button class="solo ${m.solo ? 'on' : ''}" title="Solo">S</button>
    <button class="mute ${m.muted ? 'on' : ''}">${m.muted ? 'Muet' : 'Son'}</button>
  `;
  const toggle = () => { m.expanded = !m.expanded; saveState(); renderTracks(); };
  header.querySelector('.chevron').addEventListener('click', toggle);
  header.querySelector('.track-name').addEventListener('click', toggle);
  header.querySelector('.mute').addEventListener('click', (e) => {
    e.stopPropagation(); m.muted = !m.muted; saveState(); renderTracks();
  });
  header.querySelector('.solo').addEventListener('click', (e) => {
    e.stopPropagation();
    m.solo = !m.solo;
    e.currentTarget.classList.toggle('on', m.solo);
    saveState();
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

  // Duty cycle (pulse width) — affects the square wave.
  const duties = [[0.125, '12%'], [0.25, '25%'], [0.5, '50%'], [0.75, '75%']];
  const dutyRow = document.createElement('div');
  dutyRow.className = 'track-tools';
  dutyRow.innerHTML = `<span class="tools-label" title="Largeur d'impulsion (onde carrée)">Pulse</span>`;
  for (const [val, lbl] of duties) {
    const b = document.createElement('button');
    b.className = 'pill' + (Math.abs(m.duty - val) < 1e-3 ? ' on' : '') + (m.type !== 'square' ? ' dim' : '');
    b.textContent = lbl;
    b.title = m.type !== 'square' ? 'Actif avec l\'onde Carré' : `Duty ${lbl}`;
    b.addEventListener('click', () => { m.duty = val; saveState(); renderTracks(); });
    dutyRow.appendChild(b);
  }
  body.appendChild(dutyRow);

  // Arpeggiator
  const arpRow = document.createElement('div');
  arpRow.className = 'track-tools';
  arpRow.innerHTML = `<span class="tools-label">Arpège</span>`;
  for (const [mode, lbl] of [['off', 'Off'], ['up', '↑'], ['down', '↓'], ['updown', '↕']]) {
    const b = document.createElement('button');
    b.className = 'pill' + (m.arp === mode ? ' on' : '');
    b.textContent = lbl;
    b.addEventListener('click', () => { m.arp = mode; saveState(); renderTracks(); });
    arpRow.appendChild(b);
  }
  if (m.arp !== 'off') {
    const sep = document.createElement('span');
    sep.className = 'tools-label sep'; sep.textContent = 'Vitesse';
    arpRow.appendChild(sep);
    for (const r of [2, 3, 4]) {
      const b = document.createElement('button');
      b.className = 'pill' + (m.arpRate === r ? ' on' : '');
      b.textContent = '×' + r;
      b.addEventListener('click', () => { m.arpRate = r; saveState(); renderTracks(); });
      arpRow.appendChild(b);
    }
  }
  body.appendChild(arpRow);

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
      cell.className = 'cell' + beatClass(s) + (isSharp(midi) ? ' sharp' : '') + (p[t.id].cells[key] ? ' active' : '')
        + (midiArmed && !engine.isPlaying && t.id === midiTarget && s === writeStep ? ' writehead' : '');
      cell.dataset.step = s;
      cell.dataset.midi = midi;
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

// Update one cell's visual state in place (no full re-render -> keeps scroll).
function setCellActive(trackId, midi, step, active) {
  const el = tracksEl.querySelector(`[data-track="${trackId}"] .cell[data-step="${step}"][data-midi="${midi}"]`);
  if (el) el.classList.toggle('active', active);
}

function togglePitch(t, rootMidi, step) {
  const m = state.meta[t.id];
  const cells = editP()[t.id].cells;
  const shape = CHORDS[m.chord];
  const g = t.base * m.volume;

  if (!shape) {
    const key = `${rootMidi}:${step}`;
    if (cells[key]) { delete cells[key]; setCellActive(t.id, rootMidi, step, false); }
    else {
      cells[key] = true; setCellActive(t.id, rootMidi, step, true);
      engine.preview({ kind: 'tone', freq: midiToFreq(rootMidi), dur: previewDur(), gain: g, type: m.type, duty: m.duty });
    }
  } else {
    const notes = shape.map(o => rootMidi + o).filter(n => n >= t.lo && n <= t.hi);
    if (cells[`${rootMidi}:${step}`]) {
      for (const n of notes) { delete cells[`${n}:${step}`]; setCellActive(t.id, n, step, false); }
    } else {
      for (const n of notes) { cells[`${n}:${step}`] = true; setCellActive(t.id, n, step, true); }
      for (const n of notes) engine.preview({ kind: 'tone', freq: midiToFreq(n), dur: previewDur(), gain: g * 0.8, type: m.type, duty: m.duty });
    }
  }
  saveState();
  updateBadge(t.id);
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
engine.onPatternDraw = (idx, pos) => { playingPattern = idx; playingPos = pos == null ? -1 : pos; renderSong(); };

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
    engine.setChain(currentChain());
    engine.start();
    playBtn.classList.add('playing'); playBtn.textContent = '■';
  }
});

const loopBtn = document.getElementById('loop');
loopBtn.addEventListener('click', () => {
  loopSection = !loopSection;
  loopBtn.classList.toggle('on', loopSection);
  if (engine.isPlaying) engine.setChain(currentChain());
  renderSong();
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

// Spacebar toggles playback (ignored while typing in a field).
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' && e.key !== ' ') return;
  const t = e.target;
  const tag = t && t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
  e.preventDefault();
  playBtn.click();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
