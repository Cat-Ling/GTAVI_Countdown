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

import { getTimeRemaining, setTimezone, currentTargetMode } from './countdown.js';
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
  triggerReleaseCinematic,
} from './renderer.js';
import {
  initAudio,
  playTick,
  resetTickPhase,
  checkFinalCountdown,
  toggleMute,
  getMuteState,
  isAudioUnlocked,
  onTrackChange,
  onUnlock,
} from './audio.js';
import { registerServiceWorker } from './pwa.js';


/**
 * Minimum splash screen duration (ms).
 * Ensures the branding registers even on fast connections.
 */
const MIN_SPLASH_DURATION = 1800;

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
 * TICK LOOP (requestAnimationFrame)
 * ═══════════════════════════════════════════
 *
 * Uses requestAnimationFrame to poll the time perfectly
 * in sync with the screen's refresh rate. We only update
 * the DOM and play audio when the actual second changes.
 * This completely prevents drift and iOS setTimeout throttling.
 * ═══════════════════════════════════════════ */

let rAFId = null;
let lastSecondStr = '';

/**
 * The main render loop, runs every frame (usually 60fps).
 */
function tickLoop() {
  const time = getTimeRemaining();
  
  /* Create a string representation to detect when the second ticks over */
  const currentSecondStr = `${time.days}:${time.hours}:${time.minutes}:${time.seconds}`;
  
  if (currentSecondStr !== lastSecondStr) {
    lastSecondStr = currentSecondStr;
    
    updateDisplay(time);
    playTick();
    checkFinalCountdown(time.total);
  }

  /* Must check release state on EVERY frame independently of second ticks,
     because once it hits 00:00:00:00, the second string never changes again! */
  if (time.released) {
    console.log('[App] GTA VI has been released! 🎮');
    triggerReleaseCinematic();
    return; /* Stop the loop */
  }

  rAFId = requestAnimationFrame(tickLoop);
}

/**
 * Display-only sync — no audio.
 * Used when returning from a background tab to update
 * stale values without triggering a double tick/tock.
 */
function syncOnly() {
  const time = getTimeRemaining();
  lastSecondStr = `${time.days}:${time.hours}:${time.minutes}:${time.seconds}`;
  updateDisplay(time);
  checkFinalCountdown(time.total);
}

/**
 * Starts the tick loop.
 */
function startTick() {
  if (rAFId === null) {
    rAFId = requestAnimationFrame(tickLoop);
  }
}

/**
 * Stops the tick loop.
 */
function cancelTick() {
  if (rAFId !== null) {
    cancelAnimationFrame(rAFId);
    rAFId = null;
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
      cancelTick();
    } else {
      /* User returned — sync silently */
      syncOnly();
      
      const time = getTimeRemaining();
      if (!time.released) {
        /* Only resume the tick loop if we are still counting down */
        resetTickPhase();
        startTick();
      }
    }
  });
}


/* ═══════════════════════════════════════════
 * MAIN INIT
 * ═══════════════════════════════════════════ */

async function init() {
  cacheElements();
  
  /* Setup UI handlers immediately to catch splash-screen interactions */
  setupAudioPill();
  setupTimezoneToggle();

  /* Preload everything during the splash */
  const splashStart = Date.now();
  await Promise.all([
    preloadImage('/artwork.webp'),
    preloadImage('/logo.webp'),
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

  /* Check if already released before starting the loop */
  const initialTime = getTimeRemaining();
  if (initialTime.released) {
    console.log('[App] GTA VI is already released! 🎮');
    triggerReleaseCinematic(true);
  } else {
    /* Start the requestAnimationFrame tick loop */
    startTick();
  }

  /* Service worker */
  registerServiceWorker();

  /* Tab visibility handling */
  setupVisibilityHandler();

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
let justUnlocked = false;

function setupAudioPill() {
  const pill = document.getElementById('audio-pill');
  const trackEl = document.getElementById('audio-track');
  if (!pill || !trackEl) return;

  /* Toggle mute on click */
  pill.addEventListener('click', () => {
    if (justUnlocked) {
      /* The user clicked the mute button to unlock audio.
         Because the browser forces a muted state before interaction, 
         their intent in clicking the button was to hear sound.
         Force the state to unmuted, regardless of what was saved. */
      if (getMuteState() === true) {
        toggleMute();
      }
      pill.classList.remove('audio-pill--muted');
      expandPill('Unmuted', 2000);
      return;
    }

    const muted = toggleMute();
    pill.classList.toggle('audio-pill--muted', muted);

    /* Briefly show mute state */
    expandPill(muted ? 'Muted' : 'Unmuted', 2000);
  });

  /* When user gesture first unlocks audio across the page */
  onUnlock(() => {
    justUnlocked = true;
    setTimeout(() => justUnlocked = false, 100);
    
    /* Sync UI with the user's saved preference */
    const isMuted = getMuteState();
    pill.classList.toggle('audio-pill--muted', isMuted);
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


/* ═══════════════════════════════════════════
 * TIMEZONE TOGGLE
 * ═══════════════════════════════════════════ */

function setupTimezoneToggle() {
  const btn = document.getElementById('timezone-toggle');
  if (!btn) return;
  
  // Restore saved preference
  const savedMode = localStorage.getItem('gtavi_timezone_mode') || 'UK';
  if (savedMode !== currentTargetMode) {
    setTimezone(savedMode);
  }
  btn.textContent = savedMode;
  
  btn.addEventListener('click', () => {
    const newMode = currentTargetMode === 'UK' ? 'local' : 'UK';
    setTimezone(newMode);
    btn.textContent = newMode;
    
    // Save preference
    localStorage.setItem('gtavi_timezone_mode', newMode);
    
    // Force a display update immediately
    syncOnly();
  });
}

/* ─── Boot ─── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
