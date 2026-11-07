// Match sounds, made on the fly with the Web Audio API (no audio files): the referee's whistle, the crowd
// cheering a home goal, booing an away goal, and an "ooh" for a penalty that goes begging.
// Browsers only allow sound after the player has clicked something, so the audio starts on the first click.

type Crowd = 'cheer' | 'boo' | 'ooh';

const KEY = 'pebolim.sound';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
  if (master) master.gain.value = on ? 0.55 : 0;
  if (!on) stopCrowdBed();
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = soundOn() ? 0.55 : 0;
    master.connect(ctx.destination);
    // two seconds of white noise, reused for every crowd sound
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// unlock the audio on the first click or key press
if (typeof window !== 'undefined') {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** The referee's pea whistle: short (a foul or a card), long (a penalty), or the three blasts of full time. */
export function whistle(kind: 'short' | 'long' | 'double' | 'final' = 'short') {
  const a = audio();
  if (!a || !master || !soundOn()) return;
  const blasts: [number, number][] =
    kind === 'final' ? [[0, 0.32], [0.42, 0.32], [0.84, 0.9]] : kind === 'double' ? [[0, 0.3], [0.4, 0.55]] : kind === 'long' ? [[0, 0.85]] : [[0, 0.28]];
  for (const [start, len] of blasts) {
    const t0 = a.currentTime + start;
    const osc = a.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 2650;
    // the pea rattling inside the whistle: a fast trill on the pitch
    const lfo = a.createOscillator();
    lfo.frequency.value = 32;
    const depth = a.createGain();
    depth.gain.value = 140;
    lfo.connect(depth).connect(osc.frequency);
    const g = a.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.32, t0 + 0.02);
    g.gain.setValueAtTime(0.32, t0 + len - 0.05);
    g.gain.linearRampToValueAtTime(0, t0 + len);
    osc.connect(g).connect(master);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + len + 0.02);
    lfo.stop(t0 + len + 0.02);
  }
}

/** The crowd: a roar for a home goal, boos for an away goal, an "ooh" for a missed chance. */
export function crowd(kind: Crowd) {
  const a = audio();
  if (!a || !master || !noise || !soundOn()) return;
  const t0 = a.currentTime;
  const len = kind === 'cheer' ? 4.2 : kind === 'boo' ? 3.2 : 1.6;
  const src = a.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  const out = a.createGain();
  out.gain.value = 1;
  if (kind === 'cheer') {
    // thousands of voices: bright noise that swells, holds and fades
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 0.6;
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 250;
    src.connect(hp).connect(bp).connect(g);
    g.gain.linearRampToValueAtTime(0.9, t0 + 0.35);
    g.gain.linearRampToValueAtTime(0.75, t0 + 1.6);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
  } else {
    // a low "uuu" (boos) or a short rising "ooh": voiced formants over the noise
    const f1 = a.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = kind === 'boo' ? 280 : 420;
    f1.Q.value = 5;
    const f2 = a.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = kind === 'boo' ? 650 : 900;
    f2.Q.value = 6;
    const mix = a.createGain();
    mix.gain.value = 3.5;
    src.connect(f1).connect(mix);
    src.connect(f2).connect(mix);
    mix.connect(g);
    // a slow wobble: a crowd never boos in unison
    const lfo = a.createOscillator();
    lfo.frequency.value = kind === 'boo' ? 1.7 : 0.8;
    const depth = a.createGain();
    depth.gain.value = kind === 'boo' ? 40 : 120;
    lfo.connect(depth).connect(f1.frequency);
    lfo.start(t0);
    lfo.stop(t0 + len);
    if (kind === 'ooh') f1.frequency.linearRampToValueAtTime(560, t0 + 0.5);
    g.gain.linearRampToValueAtTime(kind === 'boo' ? 0.8 : 0.7, t0 + (kind === 'boo' ? 0.5 : 0.25));
    g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
  }
  g.connect(out).connect(master);
  src.start(t0);
  src.stop(t0 + len + 0.05);
}

// ---- the crowd under the match: a murmur that swells with the pressure and roars at the chances
let bed: { src: AudioBufferSourceNode; gain: GainNode; bp: BiquadFilterNode } | null = null;

/** Set the crowd's background noise for the match on screen: 0 = silent, 1 = roaring. It glides to the new level. */
export function crowdBed(level: number) {
  const a = audio();
  if (!a || !master || !noise) return;
  if (!soundOn() || level <= 0) {
    if (bed) bed.gain.gain.setTargetAtTime(0, a.currentTime, 0.4);
    return;
  }
  if (!bed) {
    const src = a.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    // thousands of distant voices: noise with the hiss and the rumble taken out
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 220;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.5;
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const g = a.createGain();
    g.gain.value = 0;
    src.connect(hp).connect(bp).connect(lp).connect(g).connect(master);
    src.start();
    bed = { src, gain: g, bp };
  }
  const v = Math.min(1, level);
  bed.gain.gain.setTargetAtTime(0.04 + 0.32 * v, a.currentTime, 0.5);
  // a roaring crowd sounds brighter
  bed.bp.frequency.setTargetAtTime(550 + 650 * v, a.currentTime, 0.5);
}

/** Silence the crowd (leaving the match screen). */
export function stopCrowdBed() {
  if (!bed || !ctx) return;
  const b = bed;
  bed = null;
  b.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  window.setTimeout(() => {
    try {
      b.src.stop();
    } catch {
      /* already stopped */
    }
  }, 1500);
}
