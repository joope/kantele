// Audio engine: Karplus-Strong physical model + reverb + damping
// Uses Web Audio API directly — no dependencies

// Default sound parameters — exposed for UI control
export const DEFAULT_PARAMS = {
  brightness: 0.75,    // 0..1 — how bright/noisy the excitation is
  attackSoftness: 0.15, // 0..0.5 — finger onset ramp (0=nail, 0.5=very soft pad)
  decay: 0.998,        // 0.990..1.000 — string sustain length
  damping: 0.40,       // 0..1 — KS low-pass (0=very bright sustain, 1=very warm)
  body: 3.0,           // 0..10 — body resonance boost (dB) around 200-400Hz
  presence: 5.0,       // 0..12 — upper harmonic boost (dB)
  highShelf: 4.0,      // -6..12 — high shelf gain (dB) at 4kHz+
  lpCutoff: 8000,      // 2000..16000 — master low-pass cutoff Hz
};

/** Create the audio engine. Call .init() after a user gesture. */
export function createAudioEngine() {
  let ctx = null;
  let masterGain = null;
  let compressor = null;
  let reverbNode = null;
  let reverbGain = null;
  let dryGain = null;
  let voices = new Map();
  let maxVoicesPerString = 2;
  let reverbAmount = 0.4;

  // Live-tweakable params
  const params = { ...DEFAULT_PARAMS };

  async function init() {
    if (ctx) return;
    ctx = new AudioContext({ latencyHint: 'interactive' });

    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.1;
    compressor.connect(ctx.destination);

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(compressor);

    dryGain = ctx.createGain();
    dryGain.gain.value = 1 - reverbAmount;
    dryGain.connect(masterGain);

    reverbGain = ctx.createGain();
    reverbGain.gain.value = reverbAmount;
    reverbNode = await createReverbConvolver(ctx);
    reverbGain.connect(reverbNode);
    reverbNode.connect(masterGain);

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  function setReverbAmount(amount) {
    reverbAmount = amount;
    if (dryGain) dryGain.gain.value = 1 - amount;
    if (reverbGain) reverbGain.gain.value = amount;
  }

  function setParam(key, value) {
    params[key] = value;
  }

  function getParams() {
    return { ...params };
  }

  function pluck(stringIndex, frequency, velocity, direction = 1) {
    if (!ctx) return;

    if (!voices.has(stringIndex)) voices.set(stringIndex, []);
    const pool = voices.get(stringIndex);

    while (pool.length >= maxVoicesPerString) {
      const old = pool.shift();
      try {
        old.gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.02);
        setTimeout(() => { try { old.source.stop(); } catch (_) {} }, 50);
      } catch (_) {}
    }

    const voice = createKarplusStrongVoice(ctx, frequency, velocity, direction, params);

    voice.output.connect(dryGain);
    voice.output.connect(reverbGain);

    pool.push(voice);

    const decayTime = 2 + 4 * (1 - frequency / 2000);
    setTimeout(() => {
      const idx = pool.indexOf(voice);
      if (idx !== -1) pool.splice(idx, 1);
    }, Math.max(decayTime * 1000, 2000));
  }

  function damp(stringIndex) {
    if (!ctx) return;
    const dampTime = 0.02;
    const now = ctx.currentTime;

    if (stringIndex === 'all') {
      for (const [, pool] of voices) {
        for (const voice of pool) {
          voice.gainNode.gain.linearRampToValueAtTime(0, now + dampTime);
        }
      }
      voices.clear();
    } else {
      const pool = voices.get(stringIndex);
      if (!pool) return;
      for (const voice of pool) {
        voice.gainNode.gain.linearRampToValueAtTime(0, now + dampTime);
      }
      voices.delete(stringIndex);
    }
  }

  function isInitialized() {
    return ctx !== null;
  }

  return { init, pluck, damp, setReverbAmount, setParam, getParams, isInitialized };
}


function createKarplusStrongVoice(ctx, frequency, velocity, direction, params) {
  const sampleRate = ctx.sampleRate;
  const delayLength = Math.round(sampleRate / frequency);
  const buffer = new Float32Array(delayLength);

  // Excitation burst shaped by params
  const bright = params.brightness * (0.8 + 0.2 * velocity);
  const onsetLen = Math.max(1, Math.floor(delayLength * params.attackSoftness));

  for (let i = 0; i < delayLength; i++) {
    const noise = Math.random() * 2 - 1;
    // Onset ramp controlled by attackSoftness
    const onset = Math.min(1, i / onsetLen);
    // Gentle rolloff toward end
    const rolloff = 1 - (i / delayLength) * 0.3;
    // Moving average width scales with softness (wider = softer finger)
    const smoothing = 0.2 + params.attackSoftness * 0.6;
    const prev = i > 0 ? buffer[i - 1] : 0;
    buffer[i] = (noise * (1 - smoothing) + prev * smoothing) * onset * rolloff * (0.5 + bright * 0.5);
  }

  // KS feedback parameters from sliders
  const decay = params.decay;
  // damping controls how much high-freq is removed each cycle
  // 0 = bright (blend near 0.5), 1 = warm (blend near 0.1)
  const blend = 0.5 - params.damping * 0.4;

  const duration = 6;
  const totalSamples = Math.floor(sampleRate * duration);
  const audioBuffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = audioBuffer.getChannelData(0);

  let readPos = 0;
  for (let i = 0; i < totalSamples; i++) {
    const curr = readPos;
    const next = (readPos + 1) % delayLength;
    buffer[curr] = (buffer[curr] * blend + buffer[next] * (1 - blend)) * decay;
    data[i] = buffer[curr];
    readPos = next;
  }

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;

  const gainNode = ctx.createGain();
  const vol = 0.15 + 0.45 * velocity;
  gainNode.gain.setValueAtTime(vol, ctx.currentTime);

  // Body resonance — low-mid warmth
  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = 'peaking';
  bodyFilter.frequency.value = 300;
  bodyFilter.Q.value = 1.2;
  bodyFilter.gain.value = params.body;

  // Upper harmonic presence
  const presenceFilter = ctx.createBiquadFilter();
  presenceFilter.type = 'peaking';
  presenceFilter.frequency.value = 3000 + frequency * 0.5;
  presenceFilter.Q.value = 0.8;
  presenceFilter.gain.value = params.presence;

  // High shelf
  const highShelf = ctx.createBiquadFilter();
  highShelf.type = 'highshelf';
  highShelf.frequency.value = 4000;
  highShelf.gain.value = params.highShelf;

  // Master low-pass
  const lpFilter = ctx.createBiquadFilter();
  lpFilter.type = 'lowpass';
  lpFilter.frequency.value = params.lpCutoff;
  lpFilter.Q.value = 0.5;

  source.connect(bodyFilter);
  bodyFilter.connect(presenceFilter);
  presenceFilter.connect(highShelf);
  highShelf.connect(lpFilter);
  lpFilter.connect(gainNode);

  source.start();

  return { source, gainNode, output: gainNode };
}


async function createReverbConvolver(ctx) {
  const convolver = ctx.createConvolver();
  const rate = ctx.sampleRate;
  const length = rate * 1.8;
  const impulse = ctx.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const earlyReflection = t < 0.04 ? 0.8 : 0;
      const decay = Math.exp(-3.5 * t);
      data[i] = (Math.random() * 2 - 1) * decay * 0.5 + earlyReflection * (Math.random() * 2 - 1) * 0.2;
    }
  }

  convolver.buffer = impulse;
  return convolver;
}
