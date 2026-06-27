// ============================================================================
// ChiptuneEngine — real-time 8-bit style synthesis + step scheduler
// Built on the Web Audio API. No samples, everything is generated on the fly.
// ============================================================================

// Frequency for a MIDI note number (A4 = 69 = 440 Hz).
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiToName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}
export function isSharp(midi) {
  return NOTE_NAMES[midi % 12].includes('#');
}

export class ChiptuneEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;

    this.bpm = 120;
    this.steps = 16;
    this.isPlaying = false;

    this.currentStep = 0;
    this.nextNoteTime = 0;
    this.scheduleAheadTime = 0.12; // seconds of lookahead
    this.lookaheadMs = 25;
    this.timer = null;

    // Filled by the app: returns the list of voice events for a given step.
    // [{ kind, freq, dur, gain, type }]
    this.stepProvider = null;
    // UI callback queue of upcoming steps {step, time}
    this._queue = [];
    this.onStepDraw = null; // called from rAF with the active step index
  }

  // Audio context can only start after a user gesture on iOS.
  resume() {
    if (!this.ctx) this._init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;

    // Soft limiter so stacked voices don't clip / hurt on headphones.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;

    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    this.noiseBuffer = this._makeNoiseBuffer();
  }

  _makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  setBpm(v) { this.bpm = v; }
  setSteps(v) { this.steps = v; }

  start() {
    if (this.isPlaying) return;
    this.resume();
    this.isPlaying = true;
    this.currentStep = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this._scheduler();
    this._draw();
  }

  stop() {
    this.isPlaying = false;
    clearTimeout(this.timer);
    this._queue = [];
    this.currentStep = 0;
    if (this.onStepDraw) this.onStepDraw(-1);
  }

  // One sixteenth-note duration in seconds is derived from BPM.
  // A "step" is one slot in the grid regardless of resolution; we keep a
  // quarter note = 4 steps when steps-per-bar is 16 (standard 4/4 feel).
  _secondsPerStep() {
    const stepsPerBeat = this.steps / 4; // 16 steps => 4 per beat
    return 60.0 / this.bpm / stepsPerBeat;
  }

  _scheduler() {
    if (!this.isPlaying) return;
    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
      this._scheduleStep(this.currentStep, this.nextNoteTime);
      this._queue.push({ step: this.currentStep, time: this.nextNoteTime });
      this.nextNoteTime += this._secondsPerStep();
      this.currentStep = (this.currentStep + 1) % this.steps;
    }
    this.timer = setTimeout(() => this._scheduler(), this.lookaheadMs);
  }

  _draw() {
    if (!this.isPlaying) return;
    const now = this.ctx.currentTime;
    let active = -1;
    while (this._queue.length && this._queue[0].time <= now) {
      active = this._queue.shift().step;
    }
    if (active !== -1 && this.onStepDraw) this.onStepDraw(active);
    requestAnimationFrame(() => this._draw());
  }

  _scheduleStep(step, time) {
    if (!this.stepProvider) return;
    const voices = this.stepProvider(step);
    for (const v of voices) {
      switch (v.kind) {
        case 'kick': this._kick(time, v.gain); break;
        case 'snare': this._snare(time, v.gain); break;
        case 'hat': this._hat(time, v.gain); break;
        case 'tone': this._tone(time, v.freq, v.dur, v.gain, v.type); break;
      }
    }
  }

  // ---- Preview a single voice immediately (for tapping cells) ----
  preview(voice) {
    this.resume();
    const t = this.ctx.currentTime + 0.001;
    switch (voice.kind) {
      case 'kick': this._kick(t, voice.gain); break;
      case 'snare': this._snare(t, voice.gain); break;
      case 'hat': this._hat(t, voice.gain); break;
      case 'tone': this._tone(t, voice.freq, voice.dur, voice.gain, voice.type); break;
    }
  }

  // ---- Drum voices ----
  _kick(time, gain = 1) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(g); g.connect(this.master);
    osc.start(time); osc.stop(time + 0.24);
  }

  _snare(time, gain = 1) {
    // Noise body
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'highpass'; nf.frequency.value = 1400;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.8, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    noise.connect(nf); nf.connect(ng); ng.connect(this.master);
    noise.start(time); noise.stop(time + 0.2);
    // Tonal snap
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'triangle'; osc.frequency.value = 180;
    og.gain.setValueAtTime(gain * 0.5, time);
    og.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
    osc.connect(og); og.connect(this.master);
    osc.start(time); osc.stop(time + 0.12);
  }

  _hat(time, gain = 1) {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain * 0.5, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    noise.connect(f); f.connect(g); g.connect(this.master);
    noise.start(time); noise.stop(time + 0.06);
  }

  // ---- Pitched voice (bass / lead) ----
  _tone(time, freq, dur, gain = 0.5, type = 'square') {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    // Snappy chiptune envelope
    const a = 0.005, r = Math.min(0.06, dur * 0.5);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + a);
    g.gain.setValueAtTime(gain, time + Math.max(a, dur - r));
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(time); osc.stop(time + dur + 0.02);
  }
}
