// Procedural WebAudio sound engine – every sound is synthesized at runtime.
import type { Sound } from '../registry/blocks';

export interface Volumes { master: number; music: number; sfx: number; ambient: number; muted: boolean }

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode; private sfx!: GainNode; private music!: GainNode; private amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private rainNode: AudioBufferSourceNode | null = null; private rainGain!: GainNode;
  private windGain!: GainNode;
  private lavaGain!: GainNode;
  private musicTimer = 0;
  vol: Volumes = { master: 0.8, music: 0.4, sfx: 0.8, ambient: 0.6, muted: false };
  listener = { x: 0, y: 0, z: 0, yaw: 0 };

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try { this.ctx = new AudioContext(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.connect(this.master);
    this.amb = c.createGain(); this.amb.connect(this.master);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // looping ambience beds
    const bed = (freq: number, q: number, type: BiquadFilterType) => {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(this.amb); s.start();
      return { s, g };
    };
    const rain = bed(1800, 0.4, 'highpass'); this.rainNode = rain.s; this.rainGain = rain.g;
    this.windGain = bed(400, 0.6, 'lowpass').g;
    this.lavaGain = bed(180, 1.2, 'lowpass').g;
    this.applyVolumes();
  }
  applyVolumes() {
    if (!this.ctx) return;
    const m = this.vol.muted ? 0 : this.vol.master;
    this.master.gain.value = m;
    this.sfx.gain.value = this.vol.sfx;
    this.music.gain.value = this.vol.music * 0.5;
    this.amb.gain.value = this.vol.ambient;
  }
  setAmbience(rain: number, wind: number, lava: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(rain * 0.35, t, 0.5);
    this.windGain.gain.setTargetAtTime(wind * 0.12, t, 1);
    this.lavaGain.gain.setTargetAtTime(lava * 0.25, t, 0.5);
  }
  /** returns gain + pan for a world position */
  private spatial(x?: number, y?: number, z?: number): [number, number] {
    if (x === undefined) return [1, 0];
    const dx = x - this.listener.x, dy = (y ?? 0) - this.listener.y, dz = (z ?? 0) - this.listener.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 32) return [0, 0];
    const g = Math.max(0, 1 - d / 32) ** 1.5;
    const ang = Math.atan2(dx, dz) + this.listener.yaw;
    return [g, Math.max(-1, Math.min(1, -Math.sin(ang) * Math.min(1, d / 4)))];
  }
  private out(gain: number, pan: number, dest?: AudioNode): AudioNode {
    const c = this.ctx!;
    const g = c.createGain(); g.gain.value = gain;
    const p = c.createStereoPanner(); p.pan.value = pan;
    g.connect(p); p.connect(dest ?? this.sfx);
    return g;
  }
  noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', pos?: [number, number, number], sweep?: number) {
    if (!this.ctx) return;
    const [sg, pan] = this.spatial(...(pos ?? []));
    if (sg <= 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.out(sg, pan));
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', pos?: [number, number, number], slide?: number, dest?: 'music') {
    if (!this.ctx) return;
    const [sg, pan] = this.spatial(...(pos ?? []));
    if (sg <= 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out(sg, pan, dest === 'music' ? this.music : undefined));
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* -------- semantic sounds -------- */
  private mat(s: Sound): [number, number, number, BiquadFilterType] {
    switch (s) {
      case 'stone': return [900, 1.2, 0.5, 'bandpass'];
      case 'wood': return [420, 2.5, 0.5, 'bandpass'];
      case 'grass': return [2600, 0.7, 0.35, 'highpass'];
      case 'sand': return [3200, 0.5, 0.3, 'highpass'];
      case 'gravel': return [1400, 0.8, 0.45, 'bandpass'];
      case 'glass': return [3800, 6, 0.4, 'bandpass'];
      case 'wool': return [600, 0.4, 0.25, 'lowpass'];
      case 'metal': return [2200, 9, 0.35, 'bandpass'];
      case 'snow': return [2000, 0.6, 0.25, 'highpass'];
      default: return [800, 1, 0.3, 'bandpass'];
    }
  }
  dig(s: Sound, pos: [number, number, number]) { const [f, q, g, t] = this.mat(s); this.noise(0.08, f * 0.9, q, g * 0.6, t, pos); }
  breakBlock(s: Sound, pos: [number, number, number]) {
    const [f, q, g, t] = this.mat(s);
    this.noise(0.22, f, q, g, t, pos, f * 0.5);
    if (s === 'glass') for (let i = 0; i < 4; i++) setTimeout(() => this.tone(2400 + Math.random() * 2400, 0.12, 0.08, 'triangle', pos), i * 30);
    if (s === 'wood') this.tone(160, 0.12, 0.15, 'triangle', pos, 90);
  }
  place(s: Sound, pos: [number, number, number]) { const [f, q, g, t] = this.mat(s); this.noise(0.12, f * 0.7, q, g * 0.9, t, pos); if (s === 'stone' || s === 'wood') this.tone(s === 'stone' ? 140 : 220, 0.08, 0.12, 'triangle', pos, 80); }
  step(s: Sound, pos: [number, number, number]) { const [f, q, g, t] = this.mat(s); this.noise(0.07, f, q, g * 0.35, t, pos); }
  splash(pos?: [number, number, number]) { this.noise(0.5, 1200, 0.6, 0.4, 'lowpass', pos, 300); }
  swim() { this.noise(0.25, 700, 0.8, 0.12, 'lowpass'); }
  jump() { this.noise(0.06, 500, 1, 0.12, 'lowpass'); }
  land(h: number) { this.noise(0.12, 300, 1, Math.min(0.6, 0.1 + h * 0.05), 'lowpass'); }
  hurt() { this.tone(240, 0.18, 0.3, 'square', undefined, 120); this.noise(0.1, 800, 1, 0.2); }
  playerDie() { this.tone(300, 0.9, 0.3, 'sawtooth', undefined, 60); }
  hit(pos: [number, number, number], crit = false) { this.noise(0.09, crit ? 2400 : 1500, 1.4, 0.45, 'bandpass', pos); if (crit) this.tone(900, 0.15, 0.12, 'triangle', pos, 1500); }
  swing() { this.noise(0.1, 2600, 0.8, 0.08, 'highpass', undefined, 900); }
  click() { this.tone(1400, 0.04, 0.12, 'square'); }
  ui() { this.tone(880, 0.05, 0.08, 'triangle'); }
  craft() { this.tone(520, 0.08, 0.15, 'triangle'); setTimeout(() => this.tone(780, 0.1, 0.15, 'triangle'), 70); }
  pickup() { this.tone(1200 + Math.random() * 300, 0.06, 0.1, 'sine', undefined, 1800); }
  xp() { this.tone(1600 + Math.random() * 800, 0.08, 0.07, 'sine'); }
  levelUp() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 0.15, 'triangle'), i * 90)); }
  eat() { this.noise(0.09, 1800, 1.5, 0.25); }
  drink() { this.tone(300, 0.15, 0.15, 'sine', undefined, 500); }
  bow() { this.noise(0.15, 900, 3, 0.3, 'bandpass', undefined, 300); }
  explode(pos: [number, number, number]) { this.noise(1.6, 400, 0.4, 1.2, 'lowpass', pos, 40); this.tone(60, 1, 0.5, 'sine', pos, 25); }
  fuse(pos: [number, number, number]) { this.noise(0.9, 4000, 0.8, 0.25, 'highpass', pos, 6000); }
  thunder() { this.noise(3, 120, 0.5, 1.2, 'lowpass', undefined, 40); }
  door(pos: [number, number, number], open: boolean) { this.noise(0.18, open ? 500 : 380, 3, 0.35, 'bandpass', pos); }
  lever(pos: [number, number, number]) { this.tone(700, 0.05, 0.15, 'square', pos); }
  piston(pos: [number, number, number]) { this.noise(0.18, 300, 1, 0.4, 'lowpass', pos, 120); }
  fire(pos: [number, number, number]) { this.noise(0.4, 1200, 0.3, 0.12, 'bandpass', pos); }
  portal() { this.tone(110, 2, 0.25, 'sawtooth', undefined, 440); this.tone(220, 2, 0.15, 'sine', undefined, 880); }
  anvil() { this.tone(1800, 0.4, 0.2, 'triangle'); this.tone(2700, 0.3, 0.1, 'triangle'); }
  enchant() { [880, 1320, 1760].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, 0.08, 'sine'), i * 60)); }
  /** creature vocalisations by voice profile */
  creature(voice: string, pos: [number, number, number], kind: 'idle' | 'hurt' | 'death' = 'idle') {
    const k = kind === 'hurt' ? 1.25 : kind === 'death' ? 0.75 : 1;
    const dur = kind === 'death' ? 0.6 : 0.3;
    switch (voice) {
      case 'low': this.tone(110 * k, dur, 0.25, 'sawtooth', pos, 80 * k); break;
      case 'bleat': this.tone(420 * k, dur, 0.18, 'square', pos, 360 * k); setTimeout(() => this.tone(400 * k, 0.15, 0.12, 'square', pos), 120); break;
      case 'grunt': this.noise(0.25, 300 * k, 4, 0.4, 'bandpass', pos, 180); break;
      case 'chirp': this.tone(1600 * k, 0.08, 0.15, 'triangle', pos, 2200 * k); setTimeout(() => this.tone(1800 * k, 0.06, 0.12, 'triangle', pos), 90); break;
      case 'neigh': this.tone(600 * k, 0.5, 0.15, 'sawtooth', pos, 300); break;
      case 'squeak': this.tone(2400 * k, 0.07, 0.1, 'sine', pos, 3000); break;
      case 'groan': this.tone(90 * k, dur * 1.6, 0.25, 'sawtooth', pos, 70); this.noise(dur, 400, 2, 0.15, 'bandpass', pos); break;
      case 'rattle': for (let i = 0; i < 4; i++) setTimeout(() => this.noise(0.04, 2600, 6, 0.25, 'bandpass', pos), i * 45); break;
      case 'hiss': this.noise(0.5 * k, 5000, 0.5, 0.2, 'highpass', pos); break;
      case 'chitter': for (let i = 0; i < 5; i++) setTimeout(() => this.tone(900 + Math.random() * 500, 0.03, 0.12, 'square', pos), i * 35); break;
      case 'wisp': this.tone(1300 * k, 0.6, 0.08, 'sine', pos, 900); break;
      case 'brute': this.tone(60 * k, 0.7, 0.4, 'sawtooth', pos, 45); break;
      case 'imp': this.tone(700 * k, 0.25, 0.15, 'sawtooth', pos, 1100); break;
      case 'crystal': this.tone(1760 * k, 0.5, 0.1, 'sine', pos, 2640); this.tone(2200 * k, 0.4, 0.06, 'sine', pos); break;
      case 'folk': this.tone(300 * k, 0.2, 0.12, 'triangle', pos, 240); setTimeout(() => this.tone(260 * k, 0.15, 0.1, 'triangle', pos), 150); break;
      case 'boss': this.tone(45 * k, 1.4, 0.6, 'sawtooth', pos, 30); this.noise(1.2, 200, 0.6, 0.5, 'lowpass', pos, 60); break;
      default: this.noise(0.15, 800, 1, 0.2, 'bandpass', pos);
    }
  }
  /** sparse generative music: a few soft notes on a pentatonic scale every now and then */
  musicTick(dt: number, mood: 'day' | 'night' | 'ember' | 'void' | 'cave') {
    if (!this.ctx || this.vol.music <= 0 || this.vol.muted) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 18 + Math.random() * 40;
    const scales: Record<string, number[]> = {
      day: [261.6, 293.7, 329.6, 392, 440, 523.3], night: [220, 246.9, 261.6, 329.6, 349.2, 440],
      ember: [110, 116.5, 146.8, 164.8, 174.6], void: [196, 207.7, 261.6, 277.2, 311.1], cave: [130.8, 155.6, 174.6, 196, 233.1],
    };
    const sc = scales[mood];
    const n = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const f = sc[Math.floor(Math.random() * sc.length)] * (Math.random() < 0.3 ? 2 : 1);
      setTimeout(() => { this.tone(f, 2.4, 0.12, 'triangle', undefined, undefined, 'music'); this.tone(f * 2, 1.2, 0.03, 'sine', undefined, undefined, 'music'); }, i * (600 + Math.random() * 900));
    }
  }
}
export const audio = new AudioEngine();
