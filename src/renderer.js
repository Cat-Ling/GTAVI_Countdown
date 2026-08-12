/**
 * ═══════════════════════════════════════════════════════
 * GTA VI COUNTDOWN — DOM Renderer
 * ═══════════════════════════════════════════════════════
 *
 * Handles all DOM reads/writes for the countdown display.
 * Diffs values before touching the DOM to avoid unnecessary
 * reflows. Manages entrance animations and loader state.
 *
 * @module renderer
 */

import { formatUnit } from './countdown.js';
import { fireGlitch } from './glitch.js';


/* ─── Tracked units (order matters for iteration) ─── */
const UNITS = ['months', 'days', 'hours', 'minutes', 'seconds'];

/* ─── Units whose changes trigger a glitch burst ─── */
const GLITCH_UNITS = new Set(['months', 'days', 'hours', 'minutes']);

/* ─── Cached element references ─── */
const elements = {};

/* ─── Previous values for diffing ─── */
const previousValues = {};


/**
 * Caches DOM element references on init.
 * Avoids repeated querySelector calls every tick.
 */
export function cacheElements() {
  UNITS.forEach((unit) => {
    elements[unit] = {
      values: Array.from(document.querySelectorAll(`[data-unit="${unit}"]`)),
      container: document.getElementById(`unit-${unit}`),
    };
    previousValues[unit] = null;
  });
}


/**
 * Updates the countdown display.
 * Only mutates DOM nodes whose values actually changed.
 * Fires a glitch burst when a significant unit (month,
 * day, hour, or minute) rolls over.
 *
 * @param {Object} time - Time breakdown from getTimeRemaining()
 */
export function updateDisplay(time) {
  let shouldGlitch = false;

  UNITS.forEach((unit) => {
    const formatted = formatUnit(time[unit], unit);

    /* Skip unchanged values */
    if (previousValues[unit] === formatted) return;

    /* Value changed — update ALL DOM nodes for this unit */
    if (elements[unit] && elements[unit].values) {
      elements[unit].values.forEach(el => {
        el.textContent = formatted;
        /* Keep data-text in sync for the glitch pseudo-elements */
        el.setAttribute('data-text', formatted);
      });
    }

    const { container: containerEl } = elements[unit];
    if (!containerEl) return;

    /* Brief scale pulse on change */
    containerEl.classList.add('countdown__unit--pulse');
    setTimeout(() => containerEl.classList.remove('countdown__unit--pulse'), 200);

    /* Flag glitch for non-seconds changes */
    if (GLITCH_UNITS.has(unit)) {
      shouldGlitch = true;
    }

    previousValues[unit] = formatted;
  });

  /* Fire once per tick, even if multiple units changed */
  if (shouldGlitch) {
    fireGlitch();
  }

  /* Dramatic final 30 seconds mode */
  if (time.total <= 30000 && !time.released) {
    if (!document.body.classList.contains('is-final-30')) {
      document.body.classList.add('is-final-30');
      
      /* Delay the appearance of the center timer by 2 seconds to let the main UI vanish first.
         However, if the user loads the page with < 28 seconds left, skip the delay! */
      const delay = (time.total > 28000) ? 2000 : 0;
      setTimeout(() => {
        if (!document.body.classList.contains('is-released')) {
          document.body.classList.add('show-final-timer');
        }
      }, delay);
    }
  } else if (!time.released) {
    document.body.classList.remove('is-final-30');
    document.body.classList.remove('show-final-timer');
  }
}


/**
 * Fades out the loader.
 * The CSS transition handles the visual fade (800ms).
 * Element is removed after the transition completes.
 */
export function hideLoader() {
  const loader = document.getElementById('loader');
  if (!loader) return;

  loader.classList.add('loader--hidden');
  setTimeout(() => loader.remove(), 900);
}


/**
 * Staggers the entrance animations for content sections.
 */
export function showContent() {
  const header = document.querySelector('.app__header');
  const countdown = document.getElementById('countdown');
  const releaseInfo = document.getElementById('release-info');

  if (header) header.classList.add('app__header--visible');

  if (countdown) {
    setTimeout(() => countdown.classList.add('countdown--visible'), 200);
  }

  if (releaseInfo) {
    setTimeout(() => releaseInfo.classList.add('release-info--visible'), 500);
  }
}


/**
 * Returns all .glitch-text elements for the glitch controller.
 *
 * @returns {HTMLElement[]}
 */
export function getGlitchTextElements() {
  return Array.from(document.querySelectorAll('.glitch-text'));
}


/**
 * Triggers the cinematic release flash and shows the final UI.
 * @param {boolean} instant - If true, skips the flashbang (used for subsequent visits after release)
 */
export function triggerReleaseCinematic(instant = false) {
  const blackout = document.getElementById('blackout-overlay');
  
  /* Instantly drop the final 30 mode and apply the released mode to hide everything else */
  document.body.classList.remove('is-final-30');
  document.body.classList.remove('show-final-timer');
  document.body.classList.add('is-released');

  /* Start the post-release artwork slideshow */
  startSlideshow();
  
  if (!blackout || instant) return;
  
  /* Trigger the blackout fade to black */
  blackout.classList.add('is-blackout');
  
  /* After a few seconds, start fading it out to reveal the posters */
  setTimeout(() => {
    blackout.classList.remove('is-blackout');
    blackout.classList.add('is-fading');
  }, 2000);
}

/**
 * ═══════════════════════════════════════════
 * SLIDESHOW (POST-RELEASE)
 * ═══════════════════════════════════════════
 */
let slideshowInterval = null;
let currentSlide = 0;
const totalSlides = 20;

function startSlideshow() {
  if (slideshowInterval) return;

  const bgImage = document.getElementById('bg-image');
  const bgImageNext = document.getElementById('bg-image-next');
  if (!bgImage || !bgImageNext) return;

  /* First slide is the main artwork, start cycling from slide 1 (art-01) */
  slideshowInterval = setInterval(() => {
    currentSlide = (currentSlide % totalSlides) + 1;
    const formattedNum = String(currentSlide).padStart(2, '0');
    const nextImageUrl = `url('/artworks/art-${formattedNum}.webp')`;

    /* Preload the image in JS before showing it */
    const img = new Image();
    img.src = `/artworks/art-${formattedNum}.webp`;
    img.onload = () => {
      /* Once loaded, assign to the invisible layer and crossfade */
      bgImageNext.style.backgroundImage = nextImageUrl;
      bgImageNext.style.opacity = '1';
      
      /* Wait for crossfade to finish, then swap and reset */
      setTimeout(() => {
        bgImage.style.backgroundImage = nextImageUrl;
        bgImageNext.style.opacity = '0';
        bgImageNext.style.transition = 'none'; /* Instant hide after swap */
        
        /* Force reflow so transition is re-enabled correctly for next loop */
        void bgImageNext.offsetWidth;
        bgImageNext.style.transition = 'opacity 2s ease-in-out';
      }, 2000);
    };
  }, 7000); /* 7 second cycle */
}
