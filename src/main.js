/**
 * ═══════════════════════════════════════════════════════
 * GTA VI COUNTDOWN — Application Entry Point
 * ═══════════════════════════════════════════════════════
 *
 * Orchestrates loading, countdown, audio, and glitch:
 *
 *   1. Show the logo loader with breathing glow
 *   2. Preload artwork, fonts, and audio in parallel
 *   3. Populate the first countdown tick
 *   4. Fade the loader and reveal content
 *   5. Run a self-correcting tick loop aligned to
 *      second boundaries for tight audio sync
 *   6. Register the service worker
 *
 * Key distinction:
 *   tick()     — full tick: updates display + plays audio
 *   syncOnly() — display-only: no audio (used on tab return
 *                to avoid double tick/tock sounds)
 *
 * @module main
 */

import { getTimeRemaining } from './countdown.js';
import {
  initGlitch,
  createGlitchLayers,
} from './glitch.js';
import {
  cacheElements,
  updateDisplay,
  showContent,
  hideLoader,
  getGlitchTextElements,
} from './renderer.js';
import {
  initAudio,
  playTick,
  resetTickPhase,
  checkFinalCountdown,
  toggleMute,
  onTrackChange,
} from './audio.js';
import { registerServiceWorker } from './pwa.js';


/**
 * Minimum splash screen duration (ms).
 * Ensures the branding registers even on fast connections.
 */
const MIN_SPLASH_DURATION = 1800;

let tickTimeoutId = null;


/* ═══════════════════════════════════════════
 * PRELOADING HELPERS
 * ═══════════════════════════════════════════ */

/**
 * Preloads an image and resolves when fully decoded.
 * Always resolves (never rejects) so one failed image
 * doesn't stall the whole app.
 */
function preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(resolve).catch(resolve);
      } else {
        resolve();
      }
    };
    img.onerror = () => {
      console.warn(`[Loader] Failed to preload: ${src}`);
      resolve();
    };
    img.src = src;
  });
}

/**
 * Waits for web fonts, with a timeout fallback.
 */
function waitForFonts(timeoutMs = 3000) {
  if (!document.fonts || !document.fonts.ready) {
    return Promise.resolve();
  }
  return Promise.race([
    document.fonts.ready,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}


/* ═══════════════════════════════════════════
 * TICK LOOP
 * ═══════════════════════════════════════════
 *
 * Uses setTimeout instead of setInterval, re-calculating
 * the delay to align each tick to the next second boundary.
 * This prevents drift and keeps tick/tock sounds synced
 * with the actual clock rollover.
 *
 * setInterval(fn, 1000) drifts because each callback's
 * execution time accumulates. setTimeout self-corrects
 * by measuring how far off we are each iteration.
 * ═══════════════════════════════════════════ */

/**
 * Full tick — updates display AND plays audio.
 * This is the normal per-second callback.
 */
function tick() {
  const time = getTimeRemaining();
  updateDisplay(time);
  playTick();
  checkFinalCountdown(time.total);

  if (time.released) {
    cancelTick();
    console.log('[App] GTA VI has been released! 🎮');
    return;
  }

  scheduleNextTick();
}

/**
 * Display-only sync — no audio.
 * Used when returning from a background tab to update
 * stale values without triggering a double tick/tock.
 */
function syncOnly() {
  const time = getTimeRemaining();
  updateDisplay(time);
  checkFinalCountdown(time.total);
}

/**
 * Schedules the next tick to fire at the next second boundary.
 * Calculates milliseconds until the next whole second and
 * sets a timeout for exactly that duration.
 */
function scheduleNextTick() {
  const now = Date.now();
  const msUntilNextSecond = 1000 - (now % 1000);
  tickTimeoutId = setTimeout(tick, msUntilNextSecond);
}

/**
 * Stops the tick loop.
 */
function cancelTick() {
  if (tickTimeoutId !== null) {
    clearTimeout(tickTimeoutId);
    tickTimeoutId = null;
  }
}


/* ═══════════════════════════════════════════
 * TAB VISIBILITY
 * ═══════════════════════════════════════════
 *
 * When the user backgrounds the tab:
 *  - Tick loop is cancelled (saves CPU, prevents
 *    queued tick/tock sounds piling up)
 *  - Music keeps playing (it's a standard <audio>)
 *
 * When the tab comes back:
 *  - Display is synced silently (no audio)
 *  - Tick phase resets to "tick" for a clean start
 *  - Tick loop restarts aligned to the next second
 * ═══════════════════════════════════════════ */

function setupVisibilityHandler() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      /* Tab hidden: stop the tick loop, music continues */
      cancelTick();
    } else {
      /* Tab visible: sync display silently, restart loop */
      resetTickPhase();
      syncOnly();
      scheduleNextTick();
    }
  });
}


/* ═══════════════════════════════════════════
 * MAIN INIT
 * ═══════════════════════════════════════════ */

async function init() {
  cacheElements();

  /* Preload everything during the splash */
  const splashStart = Date.now();
  await Promise.all([
    preloadImage('/artwork.jpg'),
    preloadImage('/logo.png'),
    waitForFonts(),
    initAudio(),
  ]);

  /* Enforce minimum splash duration */
  const elapsed = Date.now() - splashStart;
  if (elapsed < MIN_SPLASH_DURATION) {
    await new Promise((r) => setTimeout(r, MIN_SPLASH_DURATION - elapsed));
  }

  /* Prepare glitch layers */
  createGlitchLayers();

  /* First display update (silent — no tick sound) */
  syncOnly();

  /* Reveal content */
  hideLoader();
  setTimeout(() => showContent(), 400);

  /* Wire up glitch (renderer fires it on unit changes) */
  initGlitch(
    document.getElementById('background'),
    getGlitchTextElements(),
  );

  /* Start the self-correcting tick loop */
  scheduleNextTick();

  /* Service worker */
  registerServiceWorker();

  /* Tab visibility handling */
  setupVisibilityHandler();

  /* Audio pill UI */
  setupAudioPill();

  console.log('[App] GTA VI Countdown initialized.');
}


/* ═══════════════════════════════════════════
 * AUDIO PILL UI
 * ═══════════════════════════════════════════
 *
 * Bottom-left pill button:
 *  - Click to mute/unmute
 *  - Expands to show the current track title
 *    when the song changes, then collapses
 * ═══════════════════════════════════════════ */

let pillCollapseTimer = null;

function setupAudioPill() {
  const pill = document.getElementById('audio-pill');
  const trackEl = document.getElementById('audio-track');
  if (!pill || !trackEl) return;

  /* Toggle mute on click */
  pill.addEventListener('click', () => {
    const muted = toggleMute();
    pill.classList.toggle('audio-pill--muted', muted);

    /* Briefly show mute state */
    expandPill(muted ? 'Muted' : 'Unmuted', 2000);
  });

  /* Expand with track title when music changes */
  onTrackChange((title) => {
    expandPill(`♪ ${title}`, 4000);
  });
}

/**
 * Expands the pill to show text, then collapses
 * after the specified duration.
 *
 * @param {string} text - Text to display
 * @param {number} durationMs - How long to stay expanded
 */
function expandPill(text, durationMs) {
  const pill = document.getElementById('audio-pill');
  const trackEl = document.getElementById('audio-track');
  if (!pill || !trackEl) return;

  /* Cancel any pending collapse */
  if (pillCollapseTimer) {
    clearTimeout(pillCollapseTimer);
  }

  /* Update text and expand */
  trackEl.textContent = text;
  pill.classList.add('audio-pill--expanded');

  /* Schedule collapse */
  pillCollapseTimer = setTimeout(() => {
    pill.classList.remove('audio-pill--expanded');
    pillCollapseTimer = null;
  }, durationMs);
}


/* ─── Boot ─── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
