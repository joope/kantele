import { TUNINGS, buildStringMidiNotes, midiToFreq, midiToName } from './tuning.js';
import { createAudioEngine, DEFAULT_PARAMS } from './audio.js';
import { createStringSurface } from './strings.js';

// --- DOM elements ---
const canvas = document.getElementById('kantele-canvas');
const tuningSelect = document.getElementById('tuning-select');
const stringCountSelect = document.getElementById('string-count');
const reverbSlider = document.getElementById('reverb-slider');
const muteBtn = document.getElementById('mute-btn');
const labelsBtn = document.getElementById('labels-btn');
const soundBtn = document.getElementById('sound-btn');
const soundPanel = document.getElementById('sound-panel');
const audioPrompt = document.getElementById('audio-prompt');

// --- State ---
let currentTuning = 'pentatonic_d';
let currentStringCount = 15;
let showLabels = false;

// --- Audio engine ---
const audio = createAudioEngine();

// --- String surface ---
const surface = createStringSurface(canvas, {
  onPluck(stringIndex, frequency, velocity, direction) {
    audio.pluck(stringIndex, frequency, velocity, direction);
  },
  onDamp(stringIndex) {
    audio.damp(stringIndex);
  },
});

// --- Init ---

function buildStrings() {
  const midiNotes = buildStringMidiNotes(currentStringCount, currentTuning);
  const stringDefs = midiNotes.map((midi) => ({
    midiNote: midi,
    frequency: midiToFreq(midi),
    noteName: midiToName(midi),
  }));
  surface.setStrings(stringDefs);
}

// Populate tuning selector
for (const [key, tuning] of Object.entries(TUNINGS)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = tuning.name;
  if (key === currentTuning) opt.selected = true;
  tuningSelect.appendChild(opt);
}

// --- Events ---

tuningSelect.addEventListener('change', (e) => {
  currentTuning = e.target.value;
  audio.damp('all');
  buildStrings();
});

stringCountSelect.addEventListener('change', (e) => {
  currentStringCount = parseInt(e.target.value, 10);
  audio.damp('all');
  buildStrings();
});

reverbSlider.addEventListener('input', (e) => {
  audio.setReverbAmount(parseInt(e.target.value, 10) / 100);
});

muteBtn.addEventListener('pointerdown', () => {
  audio.damp('all');
  muteBtn.classList.add('muting');
});
muteBtn.addEventListener('pointerup', () => {
  muteBtn.classList.remove('muting');
});
muteBtn.addEventListener('pointerleave', () => {
  muteBtn.classList.remove('muting');
});

labelsBtn.addEventListener('click', () => {
  showLabels = !showLabels;
  labelsBtn.classList.toggle('active', showLabels);
  surface.setShowLabels(showLabels);
});

// --- Sound panel toggle + sliders ---

soundBtn.addEventListener('click', () => {
  const open = soundPanel.classList.toggle('hidden');
  soundBtn.classList.toggle('active', !open);
  // Resize canvas after panel transition
  setTimeout(() => surface.resize(), 260);
});

// Map slider 0-100 range to actual parameter ranges
const PARAM_RANGES = {
  brightness:     { min: 0.1,  max: 1.0  },
  attackSoftness: { min: 0.0,  max: 0.5  },
  decay:          { min: 0.990, max: 0.9999 },
  damping:        { min: 0.0,  max: 1.0  },
  body:           { min: 0.0,  max: 10.0 },
  presence:       { min: 0.0,  max: 12.0 },
  highShelf:      { min: -6.0, max: 12.0 },
  lpCutoff:       { min: 2000, max: 16000 },
};

function sliderToParam(paramName, sliderVal) {
  const range = PARAM_RANGES[paramName];
  return range.min + (sliderVal / 100) * (range.max - range.min);
}

function paramToSlider(paramName, paramVal) {
  const range = PARAM_RANGES[paramName];
  return Math.round(((paramVal - range.min) / (range.max - range.min)) * 100);
}

// Initialize sliders to match current params
const sliders = soundPanel.querySelectorAll('input[data-param]');
sliders.forEach((slider) => {
  const paramName = slider.dataset.param;
  const currentVal = DEFAULT_PARAMS[paramName];
  const sliderVal = paramToSlider(paramName, currentVal);
  slider.value = sliderVal;
  slider.nextElementSibling.textContent = sliderVal;

  slider.addEventListener('input', () => {
    const sv = parseInt(slider.value, 10);
    slider.nextElementSibling.textContent = sv;
    const paramVal = sliderToParam(paramName, sv);
    audio.setParam(paramName, paramVal);
  });
});

// --- Audio unlock on first interaction ---
async function unlockAudio() {
  await audio.init();
  audioPrompt.classList.add('hidden');
  document.removeEventListener('pointerdown', unlockAudio);
}
document.addEventListener('pointerdown', unlockAudio);

// Keyboard support: keys map to strings
const KEY_MAP = 'asdfghjkl;qwertyuiop'.split('');
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const idx = KEY_MAP.indexOf(e.key.toLowerCase());
  if (idx !== -1 && idx < currentStringCount) {
    if (!audio.isInitialized()) {
      audio.init().then(() => {
        audioPrompt.classList.add('hidden');
      });
    }
    const midiNotes = buildStringMidiNotes(currentStringCount, currentTuning);
    const midi = midiNotes[idx];
    audio.pluck(idx, midiToFreq(midi), 0.6, 1);
  }
  if (e.key === ' ') {
    e.preventDefault();
    audio.damp('all');
  }
});

// Start
buildStrings();
surface.start();
