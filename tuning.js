// Tuning presets for kantele
// Each preset defines a name, base MIDI note, and interval pattern (semitones from root)
// The interval pattern repeats across octaves as needed for the string count

export const TUNINGS = {
  pentatonic_d: {
    name: 'Pentatonic (D)',
    baseMidi: 50, // D3
    intervals: [0, 2, 4, 7, 9], // major pentatonic
  },
  pentatonic_g: {
    name: 'Pentatonic (G)',
    baseMidi: 55, // G3
    intervals: [0, 2, 4, 7, 9],
  },
  diatonic_d: {
    name: 'Diatonic (D)',
    baseMidi: 50, // D3
    intervals: [0, 2, 4, 5, 7, 9, 11], // major scale
  },
  diatonic_g: {
    name: 'Diatonic (G)',
    baseMidi: 55, // G3
    intervals: [0, 2, 4, 5, 7, 9, 11],
  },
  minor_d: {
    name: 'Minor (D)',
    baseMidi: 50,
    intervals: [0, 2, 3, 5, 7, 8, 10], // natural minor
  },
  minor_a: {
    name: 'Minor (A)',
    baseMidi: 45, // A2
    intervals: [0, 2, 3, 5, 7, 8, 10],
  },
  dorian_d: {
    name: 'Dorian (D)',
    baseMidi: 50,
    intervals: [0, 2, 3, 5, 7, 9, 10],
  },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Convert MIDI note number to frequency in Hz */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Get note name from MIDI number */
export function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

/**
 * Build an array of MIDI notes for the given string count and tuning preset.
 * Strings are ordered low to high (index 0 = lowest).
 */
export function buildStringMidiNotes(stringCount, tuningKey) {
  const tuning = TUNINGS[tuningKey];
  if (!tuning) throw new Error(`Unknown tuning: ${tuningKey}`);

  const { baseMidi, intervals } = tuning;
  const notes = [];
  const octaveSize = 12;

  for (let i = 0; i < stringCount; i++) {
    const octaveOffset = Math.floor(i / intervals.length) * octaveSize;
    const intervalIndex = i % intervals.length;
    notes.push(baseMidi + octaveOffset + intervals[intervalIndex]);
  }

  return notes;
}
