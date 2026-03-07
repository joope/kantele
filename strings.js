// String surface: Canvas rendering + pointer interaction + string-crossing detection

/**
 * Create the string surface controller.
 * Manages canvas drawing, pointer tracking, and pluck detection.
 */
export function createStringSurface(canvas, { onPluck, onDamp }) {
  const ctx = canvas.getContext('2d');
  let strings = []; // [{ y, midiNote, frequency, noteName, index }]
  let stringCount = 15;
  let showLabels = false;
  let animationFrame = null;

  // String visual state
  let stringStates = []; // [{ vibration: 0..1, phase: 0, glowIntensity: 0 }]

  // Pointer tracking for string-crossing detection
  const pointers = new Map(); // pointerId -> { prevY, isDown }

  // Layout constants
  const PADDING_TOP = 30;
  const PADDING_BOTTOM = 30;
  const PADDING_LEFT = 50;
  const PADDING_RIGHT = 20;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layoutStrings();
  }

  function layoutStrings() {
    const rect = canvas.getBoundingClientRect();
    const playHeight = rect.height - PADDING_TOP - PADDING_BOTTOM;
    const spacing = stringCount > 1 ? playHeight / (stringCount - 1) : 0;

    for (let i = 0; i < stringCount; i++) {
      if (strings[i]) {
        strings[i].y = PADDING_TOP + i * spacing;
      }
    }
  }

  function setStrings(stringDefs) {
    strings = stringDefs.map((def, i) => ({
      ...def,
      index: i,
      y: 0,
    }));
    stringCount = strings.length;
    stringStates = strings.map(() => ({
      vibration: 0,
      phase: Math.random() * Math.PI * 2,
      glowIntensity: 0,
    }));
    layoutStrings();
  }

  function setShowLabels(show) {
    showLabels = show;
  }

  // --- Pointer handling ---

  function getStringAtY(y) {
    if (strings.length === 0) return -1;
    const rect = canvas.getBoundingClientRect();
    const playHeight = rect.height - PADDING_TOP - PADDING_BOTTOM;
    const spacing = stringCount > 1 ? playHeight / (stringCount - 1) : playHeight;
    const hitRadius = spacing * 0.45;

    for (let i = 0; i < strings.length; i++) {
      if (Math.abs(y - strings[i].y) < hitRadius) return i;
    }
    return -1;
  }

  /** Find which strings were crossed between prevY and currY */
  function getStringsCrossed(prevY, currY) {
    const crossed = [];
    const minY = Math.min(prevY, currY);
    const maxY = Math.max(prevY, currY);

    for (let i = 0; i < strings.length; i++) {
      const sy = strings[i].y;
      if (sy >= minY && sy <= maxY) {
        crossed.push(i);
      }
    }

    // Order by direction of travel
    if (currY < prevY) crossed.reverse();
    return crossed;
  }

  function handlePointerDown(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;

    pointers.set(e.pointerId, {
      prevY: y,
      prevX: x,
      prevTime: performance.now(),
      isDown: true,
      lastTriggeredString: -1,
    });

    // Direct tap on a string
    const si = getStringAtY(y);
    if (si !== -1) {
      triggerPluck(si, 0.6, 1);
      pointers.get(e.pointerId).lastTriggeredString = si;
    }

    canvas.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e) {
    e.preventDefault();
    const ptr = pointers.get(e.pointerId);
    if (!ptr || !ptr.isDown) return;

    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    const now = performance.now();

    const crossed = getStringsCrossed(ptr.prevY, y);

    if (crossed.length > 0) {
      // Compute velocity from speed of drag
      const dy = Math.abs(y - ptr.prevY);
      const dt = Math.max(1, now - ptr.prevTime);
      const speed = dy / dt; // px per ms
      const velocity = Math.min(1, Math.max(0.15, speed / 2));
      const direction = y > ptr.prevY ? 1 : -1;

      // Add tiny strum spread for multiple strings
      const spreadMs = Math.min(30, crossed.length * 4);

      crossed.forEach((si, idx) => {
        if (si === ptr.lastTriggeredString) return;
        const delay = (idx / Math.max(1, crossed.length - 1)) * spreadMs;
        if (delay > 1) {
          setTimeout(() => triggerPluck(si, velocity, direction), delay);
        } else {
          triggerPluck(si, velocity, direction);
        }
      });

      ptr.lastTriggeredString = crossed[crossed.length - 1];
    }

    ptr.prevY = y;
    ptr.prevX = x;
    ptr.prevTime = now;
  }

  function handlePointerUp(e) {
    e.preventDefault();
    pointers.delete(e.pointerId);
  }

  function triggerPluck(stringIndex, velocity, direction) {
    const s = strings[stringIndex];
    if (!s) return;

    // Trigger audio
    onPluck(stringIndex, s.frequency, velocity, direction);

    // Trigger visual
    const state = stringStates[stringIndex];
    state.vibration = 0.6 + 0.4 * velocity;
    state.glowIntensity = 1;
    state.phase = Math.random() * Math.PI * 2;
  }

  // --- Rendering ---

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Draw wooden body background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#2a2218');
    bgGrad.addColorStop(0.5, '#332a20');
    bgGrad.addColorStop(1, '#2a2218');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle wood grain lines
    ctx.strokeStyle = 'rgba(90, 70, 50, 0.15)';
    ctx.lineWidth = 0.5;
    for (let gy = 0; gy < h; gy += 12) {
      ctx.beginPath();
      ctx.moveTo(0, gy + Math.sin(gy * 0.1) * 2);
      ctx.lineTo(w, gy + Math.sin(gy * 0.1 + 3) * 2);
      ctx.stroke();
    }

    // Draw bridge lines (left and right ends)
    const bridgeLeftX = PADDING_LEFT - 10;
    const bridgeRightX = w - PADDING_RIGHT + 5;

    ctx.strokeStyle = '#5a4a38';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bridgeLeftX, PADDING_TOP - 15);
    ctx.lineTo(bridgeLeftX, h - PADDING_BOTTOM + 15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bridgeRightX, PADDING_TOP - 15);
    ctx.lineTo(bridgeRightX, h - PADDING_BOTTOM + 15);
    ctx.stroke();

    // Draw each string
    const now = performance.now();

    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      const state = stringStates[i];

      // Decay vibration and glow
      state.vibration *= 0.993;
      state.glowIntensity *= 0.97;
      if (state.vibration < 0.001) state.vibration = 0;
      if (state.glowIntensity < 0.01) state.glowIntensity = 0;

      // String thickness varies: bass strings thicker
      const thickness = 1 + (1 - i / Math.max(1, strings.length - 1)) * 1.8;

      // Glow effect
      if (state.glowIntensity > 0.01) {
        ctx.save();
        ctx.shadowColor = '#ffe8a0';
        ctx.shadowBlur = 8 * state.glowIntensity;
        ctx.strokeStyle = `rgba(255, 232, 160, ${0.4 * state.glowIntensity})`;
        ctx.lineWidth = thickness + 3;
        ctx.beginPath();
        drawVibratingSring(ctx, s.y, state, now, bridgeLeftX + 5, bridgeRightX - 5);
        ctx.stroke();
        ctx.restore();
      }

      // Main string line
      const brightness = 0.55 + 0.25 * (i / Math.max(1, strings.length - 1));
      const r = Math.round(212 * brightness);
      const g = Math.round(196 * brightness);
      const b = Math.round(160 * brightness);
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.lineWidth = thickness;
      ctx.beginPath();
      drawVibratingSring(ctx, s.y, state, now, bridgeLeftX + 5, bridgeRightX - 5);
      ctx.stroke();

      // Note labels
      if (showLabels) {
        ctx.fillStyle = state.glowIntensity > 0.1 ? '#ffe8a0' : '#9a8e7e';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.noteName, bridgeLeftX - 6, s.y);
      }
    }

    animationFrame = requestAnimationFrame(draw);
  }

  function drawVibratingSring(ctx, baseY, state, time, x0, x1) {
    if (state.vibration < 0.002) {
      // Static line
      ctx.moveTo(x0, baseY);
      ctx.lineTo(x1, baseY);
      return;
    }

    const segments = 40;
    const segWidth = (x1 - x0) / segments;
    const amp = state.vibration * 4; // max pixel displacement
    const freq = 6 + state.phase; // visual vibration speed
    const t = time / 1000;

    ctx.moveTo(x0, baseY);
    for (let s = 1; s <= segments; s++) {
      const x = x0 + s * segWidth;
      // Standing wave: sin envelope * oscillation
      const envelope = Math.sin((s / segments) * Math.PI);
      const oscillation = Math.sin(t * freq * Math.PI * 2 + state.phase);
      // Second harmonic adds realism
      const envelope2 = Math.sin((s / segments) * Math.PI * 2);
      const osc2 = Math.sin(t * freq * 2.02 * Math.PI * 2 + state.phase * 1.3);
      const y = baseY + (envelope * oscillation * amp + envelope2 * osc2 * amp * 0.3);
      ctx.lineTo(x, y);
    }
  }

  // --- Setup and teardown ---

  function start() {
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);

    window.addEventListener('resize', resize);
    resize();
    draw();
  }

  function destroy() {
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerUp);
    window.removeEventListener('resize', resize);
    if (animationFrame) cancelAnimationFrame(animationFrame);
  }

  return { start, destroy, setStrings, setShowLabels, resize };
}
