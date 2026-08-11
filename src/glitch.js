/**
 * ═══════════════════════════════════════════════════════
 * GTA VI COUNTDOWN — Glitch Effect Controller
 * ═══════════════════════════════════════════════════════
 *
 * Manages chromatic aberration glitch effects for both
 * the background image and the countdown text.
 *
 * The glitch is triggered by the renderer when a
 * significant countdown unit changes (month, day, hour,
 * or minute). Seconds are excluded — their rapid changes
 * would make the effect feel noisy instead of impactful.
 *
 * CSS handles the actual animation (GPU-composited).
 * JS just toggles classes when told to fire.
 *
 * @module glitch
 */


/* ─── Configuration ─── */

/** Must match the CSS animation duration */
const GLITCH_DURATION = 400;

/** How many text elements to glitch per burst (1–3 random picks) */
const GLITCH_MIN_TARGETS = 1;
const GLITCH_MAX_TARGETS = 3;


/* ─── State ─── */

let backgroundElement = null;
let textElements = [];


/* ─── Helpers ─── */

/**
 * Random integer between min and max (inclusive).
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Picks N random elements from an array
 * using a partial Fisher-Yates shuffle.
 */
function pickRandom(array, count) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}


/* ─── Public API ─── */

/**
 * Stores element references for glitch targeting.
 *
 * @param {HTMLElement} bgElement - The background container
 * @param {HTMLElement[]} textEls - Countdown value elements
 */
export function initGlitch(bgElement, textEls) {
  backgroundElement = bgElement;
  textElements = textEls;
}

/**
 * Creates the three glitch clone layers in the background DOM.
 * Each layer uses a different blend mode for the chromatic
 * aberration look.
 */
export function createGlitchLayers() {
  const container = document.getElementById('bg-glitch');
  if (!container) return;

  for (let i = 1; i <= 3; i++) {
    const layer = document.createElement('div');
    layer.className = `background__glitch-layer background__glitch-layer--${i}`;
    layer.setAttribute('aria-hidden', 'true');
    container.appendChild(layer);
  }
}

/**
 * Fires a single glitch burst — background shift + random
 * text elements get the chromatic aberration treatment.
 *
 * Called by the renderer when a non-seconds unit changes.
 */
export function fireGlitch() {
  /* Background glitch */
  if (backgroundElement) {
    backgroundElement.classList.add('background--glitching');
    setTimeout(() => {
      backgroundElement.classList.remove('background--glitching');
    }, GLITCH_DURATION + 50);
  }

  /* Text glitch — pick 1-3 random countdown values */
  if (textElements.length > 0) {
    const count = randomBetween(GLITCH_MIN_TARGETS, GLITCH_MAX_TARGETS);
    const targets = pickRandom(textElements, count);

    targets.forEach((el) => el.classList.add('glitch-text--active'));

    setTimeout(() => {
      targets.forEach((el) => el.classList.remove('glitch-text--active'));
    }, GLITCH_DURATION + 50);
  }
}
