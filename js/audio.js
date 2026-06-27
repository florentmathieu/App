// ============================================================================
// ChiptuneEngine — real-time 8-bit style synthesis + step scheduler
// Built on the Web Audio API. No samples, everything is generated on the fly.
// The voice functions are context-parameterised so the exact same synthesis
// can be replayed into an OfflineAudioContext for WAV export.
// ============================================================================

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

function makeNoiseBuffer(ctx, seconds = 1.0) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export class ChiptuneEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this._unlocked = false;

    this.bpm = 120;
    this.steps = 16;
    this.isPlaying = false;

    this.currentStep = 0;
    this.nextNoteTime = 0;
    this.scheduleAheadTime = 0.12;
    this.lookaheadMs = 25;
    this.timer = null;

    this.chain = [0];
    this.chainPos = 0;

    this.stepProvider = null; // (step, patternIndex) => [voice]
    this._queue = [];
    this.onStepDraw = null;
    this.onPatternDraw = null;
    this._lastPatternDrawn = -1;
  }

  setChain(arr) {
    this.chain = (arr && arr.length) ? arr.slice() : [0];
    if (this.chainPos >= this.chain.length) this.chainPos = 0;
  }

  setBpm(v) { this.bpm = v; }
  setSteps(v) { this.steps = v; }

  // --- Context lifecycle (iOS needs a user gesture) ---
  resume() {
    if (!this.ctx) this._init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._unlock();
  }

  _unlock() {
    if (this._unlocked || !this.ctx) return;
    this._unlocked = true;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    } catch (e) { /* ignore */ }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    const comp = this._makeLimiter(this.ctx);
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.noiseBuffer = makeNoiseBuffer(this.ctx);
  }

  _makeLimiter(ctx) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    return comp;
  }

  // --- Transport ---
  start() {
    if (this.isPlaying) return;
    this.resume();
    this.isPlaying = true;
    this.currentStep = 0;
    this.chainPos = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this._scheduler();
    this._draw();
  }

  stop() {
    this.isPlaying = false;
    clearTimeout(this.timer);
    this._queue = [];
    this.currentStep = 0;
    this.chainPos = 0;
    this._lastPatternDrawn = -1;
    if (this.onStepDraw) this.onStepDraw(-1);
    if (this.onPatternDraw) this.onPatternDraw(-1);
  }

  _secondsPerStep() {
    const stepsPerBeat = this.steps / 4;
    return 60.0 / this.bpm / stepsPerBeat;
  }

  _scheduler() {
    if (!this.isPlaying) return;
    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
      const pattern = this.chain[this.chainPos] ?? 0;
      this._scheduleStep(this.currentStep, this.nextNoteTime, pattern);
      this._queue.push({ step: this.currentStep, time: this.nextNoteTime, pattern });
      this.nextNoteTime += this._secondsPerStep();
      this.currentStep = (this.currentStep + 1) % this.steps;
      if (this.currentStep === 0) this.chainPos = (this.chainPos + 1) % this.chain.length;
    }
    this.timer = setTimeout(() => this._scheduler(), this.lookaheadMs);
  }

  _draw() {
    if (!this.isPlaying) return;
    const now = this.ctx.currentTime;
    let active = -1, pattern = -1;
    while (this._queue.length && this._queue[0].time <= now) {
      const item = this._queue.shift();
      active = item.step; pattern = item.pattern;
    }
    if (active !== -1 && this.onStepDraw) this.onStepDraw(active);
    if (pattern !== -1 && pattern !== this._lastPatternDrawn && this.onPatternDraw) {
      this.onPatternDraw(pattern);
      this._lastPatternDrawn = pattern;
    }
    requestAnimationFrame(() => this._draw());
  }

  _scheduleStep(step, time, pattern = 0) {
    if (!this.stepProvider) return;
    for (const v of this.stepProvider(step, pattern)) {
      this._render(this.ctx, this.master, this.noiseBuffer, v, time);
    }
  }

  preview(voice) {
    this.resume();
    this._render(this.ctx, this.master, this.noiseBuffer, voice, this.ctx.currentTime + 0.02);
  }

  // --- Voice dispatch (ctx-parameterised) ---
  _render(ctx, dest, noise, v, time) {
    switch (v.kind) {
      case 'kick':    return this._kick(ctx, dest, time, v.gain);
      case 'snare':   return this._snare(ctx, dest, noise, time, v.gain);
      case 'hat':     return this._hat(ctx, dest, noise, time, v.gain);
      case 'openhat': return this._openhat(ctx, dest, noise, time, v.gain);
      case 'clap':    return this._clap(ctx, dest, noise, time, v.gain);
      case 'tom':     return this._tom(ctx, dest, time, v.gain);
      case 'tone':    return this._tone(ctx, dest, time, v.freq, v.dur, v.gain, v.type);
    }
  }

  // --- Drum voices ---
  _kick(ctx, dest, time, gain = 1) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + 0.24);
  }

  _snare(ctx, dest, noise, time, gain = 1) {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.8, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    n.connect(nf); nf.connect(ng); ng.connect(dest);
    n.start(time); n.stop(time + 0.2);
    const osc = ctx.createOscillator(), og = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.value = 180;
    og.gain.setValueAtTime(gain * 0.5, time);
    og.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
    osc.connect(og); og.connect(dest);
    osc.start(time); osc.stop(time + 0.12);
  }

  _hat(ctx, dest, noise, time, gain = 1) {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * 0.5, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    n.connect(f); f.connect(g); g.connect(dest);
    n.start(time); n.stop(time + 0.06);
  }

  _openhat(ctx, dest, noise, time, gain = 1) {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * 0.45, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
    n.connect(f); f.connect(g); g.connect(dest);
    n.start(time); n.stop(time + 0.34);
  }

  _clap(ctx, dest, noise, time, gain = 1) {
    // Three quick noise bursts through a band-pass for a classic clap.
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.2;
    const g = ctx.createGain();
    g.connect(dest); f.connect(g);
    const offsets = [0, 0.012, 0.024];
    g.gain.setValueAtTime(0.0001, time);
    for (const o of offsets) {
      g.gain.setValueAtTime(gain * 0.7, time + o);
      g.gain.exponentialRampToValueAtTime(0.0001, time + o + 0.05);
    }
    const n = ctx.createBufferSource(); n.buffer = noise;
    n.connect(f);
    n.start(time); n.stop(time + 0.1);
  }

  _tom(ctx, dest, time, gain = 1) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, time);
    osc.frequency.exponentialRampToValueAtTime(90, time + 0.18);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + 0.3);
  }

  // --- Pitched voice (bass / lead / arp) ---
  _tone(ctx, dest, time, freq, dur, gain = 0.5, type = 'square') {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    const a = 0.005, r = Math.min(0.06, dur * 0.5);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + a);
    g.gain.setValueAtTime(gain, time + Math.max(a, dur - r));
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + dur + 0.02);
  }

  // --- Offline render of the whole chain into an AudioBuffer ---
  async _renderBuffer() {
    if (!this.stepProvider) throw new Error('Rien à exporter');
    const sr = 44100;
    const secPerStep = this._secondsPerStep();
    const totalSteps = this.chain.length * this.steps;
    const tail = 0.6;
    const duration = totalSteps * secPerStep + tail;

    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) throw new Error('Export non supporté par ce navigateur');
    const octx = new OAC(1, Math.ceil(duration * sr), sr);

    const master = octx.createGain(); master.gain.value = 0.85;
    const comp = this._makeLimiter(octx);
    master.connect(comp); comp.connect(octx.destination);
    const noise = makeNoiseBuffer(octx);

    let t = 0;
    for (let c = 0; c < this.chain.length; c++) {
      const pattern = this.chain[c];
      for (let step = 0; step < this.steps; step++) {
        for (const v of this.stepProvider(step, pattern)) {
          this._render(octx, master, noise, v, t);
        }
        t += secPerStep;
      }
    }
    return octx.startRendering();
  }

  async renderWav() {
    return encodeWav(await this._renderBuffer());
  }

  // MP3 via vendored lamejs (loaded as a classic script -> window.lamejs).
  async renderMp3(kbps = 160) {
    const L = (typeof window !== 'undefined') && window.lamejs;
    if (!L || !L.Mp3Encoder) throw new Error('Encodeur MP3 indisponible');
    const buffer = await this._renderBuffer();
    const ch = buffer.getChannelData(0);
    const enc = new L.Mp3Encoder(1, buffer.sampleRate, kbps);
    const BLOCK = 1152;
    const i16 = new Int16Array(BLOCK);
    const chunks = [];
    for (let i = 0; i < ch.length; i += BLOCK) {
      const n = Math.min(BLOCK, ch.length - i);
      for (let j = 0; j < n; j++) {
        const s = Math.max(-1, Math.min(1, ch[i + j]));
        i16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      const buf = enc.encodeBuffer(n === BLOCK ? i16 : i16.subarray(0, n));
      if (buf.length) chunks.push(new Uint8Array(buf));
    }
    const end = enc.flush();
    if (end.length) chunks.push(new Uint8Array(end));
    return new Blob(chunks, { type: 'audio/mpeg' });
  }
}

// 16-bit PCM mono WAV encoder.
function encodeWav(buffer) {
  const samples = buffer.getChannelData(0);
  const len = samples.length;
  const sr = buffer.sampleRate;
  const blockAlign = 2; // mono, 16-bit
  const dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  let o = 0;
  const str = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i)); };
  const u32 = (v) => { view.setUint32(o, v, true); o += 4; };
  const u16 = (v) => { view.setUint16(o, v, true); o += 2; };

  str('RIFF'); u32(36 + dataSize); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(1); u32(sr); u32(sr * blockAlign); u16(blockAlign); u16(16);
  str('data'); u32(dataSize);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}
