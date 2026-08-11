/**
 * ═══════════════════════════════════════════════════════
 * GTA VI COUNTDOWN — Audio Engine
 * ═══════════════════════════════════════════════════════
 *
 * Three independent audio systems:
 *
 * 1. MUSIC PLAYER (HTMLAudioElement)
 *    Shuffled playlist. Auto-advances on track end.
 *    Loops back to the first track after the last.
 *    Retries on play failure with exponential backoff.
 *
 * 2. TICK/TOCK (Web Audio API)
 *    Uses AudioContext + decoded AudioBuffers.
 *    This avoids creating MediaSession entries every
 *    second, which causes OS media player detection
 *    overhead and eventually drops ticks.
 *    Pauses when the tab is backgrounded.
 *
 * 3. FINAL COUNTDOWN (HTMLAudioElement)
 *    Synced to end at exactly midnight (countdown = 0).
 *    Crossfades from background music when triggered.
 *
 * @module audio
 */


/* ═══════════════════════════════════════════
 * CONFIGURATION
 * ═══════════════════════════════════════════ */

const MUSIC_VOLUME    = 0.35;
const TICK_VOLUME     = 0.15;
const FINAL_VOLUME    = 0.5;
const CROSSFADE_MS    = 3000;
const FADE_STEPS      = 30;
const MUSIC_RETRY_MS  = 500;   /* Retry delay if play() rejects */
const MAX_RETRIES     = 5;

/*
 * Cinematic reverb for tick/tock.
 * A short delay with filtered feedback creates a
 * "clock ticking in an empty room" ambience.
 */
const REVERB_DELAY_SEC  = 0.12;   /* Tap delay — short for a tight echo */
const REVERB_FEEDBACK   = 0.28;   /* How much feeds back (0-1, higher = longer tail) */
const REVERB_FILTER_HZ  = 1800;   /* Lowpass cutoff — darkens each echo repeat */
const REVERB_WET_MIX    = 0.35;   /* Wet signal level relative to dry */


/* ═══════════════════════════════════════════
 * STATE
 * ═══════════════════════════════════════════ */

let playlist          = [];
let currentTrackIndex = 0;
let musicAudio        = null;
let finalAudio        = null;
let finalTrack        = { file: '', duration: 0 };

let isUnlocked        = false;
let isFinalMode       = false;
let isMusicFadingOut  = false;
let isTickNext        = true;
let isMuted           = false;

/* Callback notified when the current track changes */
let trackChangeCallback = null;

/* Web Audio API state for tick/tock */
let audioCtx          = null;
let tickBuffer        = null;
let tockBuffer        = null;
let dryGain           = null;   /* Direct signal path */
let wetGain           = null;   /* Reverb signal path */
let reverbDelay       = null;   /* Delay node for echo taps */
let reverbFilter      = null;   /* Lowpass to darken the tail */
let reverbFeedback    = null;   /* Gain controlling feedback amount */


/* ═══════════════════════════════════════════
 * INITIALIZATION
 * ═══════════════════════════════════════════ */

/**
 * Fisher-Yates shuffle — random permutation in-place.
 * Each page refresh creates a unique play order.
 */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Fetches an audio file and decodes it into an AudioBuffer
 * for use with Web Audio API. Much lighter than creating
 * HTMLAudioElement objects for short sound effects.
 */
async function fetchAudioBuffer(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return audioCtx.decodeAudioData(arrayBuffer);
}

/**
 * Loads the playlist and initializes all three audio systems.
 * Called during the splash screen phase.
 */
export async function initAudio() {
  try {
    const response = await fetch('/audio/playlist.json');
    const data = await response.json();

    /* Shuffle playlist for this session */
    playlist = shuffle([...data.playlist]);
    finalTrack = data.finalCountdown;

    /*
     * Create a single AudioContext for tick/tock.
     * This is the key fix: Web Audio API buffers don't register
     * with the OS MediaSession, so no notification spam.
     */
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    /*
     * Audio routing graph for tick/tock:
     *
     *                  ┌→ dryGain ──────────────────→ destination
     *   source ────────┤
     *                  └→ reverbDelay → reverbFilter → wetGain → destination
     *                         ↑                          │
     *                         └──── reverbFeedback ←─────┘
     *
     * The feedback loop creates decaying echo repeats.
     * The lowpass filter darkens each repeat so the tail
     * feels warm and cinematic, not harsh.
     */

    /* Dry path — the clean tick/tock sound */
    dryGain = audioCtx.createGain();
    dryGain.gain.value = TICK_VOLUME;
    dryGain.connect(audioCtx.destination);

    /* Delay node — the initial echo tap */
    reverbDelay = audioCtx.createDelay(1.0);
    reverbDelay.delayTime.value = REVERB_DELAY_SEC;

    /* Lowpass filter — each echo repeat gets darker */
    reverbFilter = audioCtx.createBiquadFilter();
    reverbFilter.type = 'lowpass';
    reverbFilter.frequency.value = REVERB_FILTER_HZ;

    /* Wet gain — controls how loud the reverb tail is */
    wetGain = audioCtx.createGain();
    wetGain.gain.value = TICK_VOLUME * REVERB_WET_MIX;
    wetGain.connect(audioCtx.destination);

    /* Feedback gain — controls how many echoes before decay */
    reverbFeedback = audioCtx.createGain();
    reverbFeedback.gain.value = REVERB_FEEDBACK;

    /* Wire the reverb chain */
    reverbDelay.connect(reverbFilter);
    reverbFilter.connect(wetGain);
    reverbFilter.connect(reverbFeedback);
    reverbFeedback.connect(reverbDelay);

    /* Decode tick/tock into reusable buffers */
    const [tick, tock] = await Promise.all([
      fetchAudioBuffer(data.countdown.tick),
      fetchAudioBuffer(data.countdown.tock),
    ]);
    tickBuffer = tick;
    tockBuffer = tock;

    /* Prepare background music and final track */
    finalAudio = new Audio(finalTrack.file);
    finalAudio.preload = 'auto';
    finalAudio.volume = FINAL_VOLUME;
    prepareTrack(0);

    /* Wire up autoplay unlock */
    setupAutoplayUnlock();

    console.log(`[Audio] Ready. Shuffled ${playlist.length} tracks. First: "${playlist[0].title}"`);
  } catch (error) {
    console.warn('[Audio] Init failed:', error);
  }
}


/* ═══════════════════════════════════════════
 * MUSIC PLAYER
 * ═══════════════════════════════════════════ */

/**
 * Loads a track into the music player by playlist index.
 */
function prepareTrack(index) {
  currentTrackIndex = index;
  const track = playlist[index];

  /* Clean up previous element */
  if (musicAudio) {
    musicAudio.onended = null;
    musicAudio.onerror = null;
    musicAudio.pause();
  }

  musicAudio = new Audio(track.file);
  musicAudio.volume = isMuted ? 0 : MUSIC_VOLUME;
  musicAudio.preload = 'auto';

  /* Auto-advance when track ends */
  musicAudio.onended = () => {
    if (!isFinalMode) advanceTrack();
  };

  /* Retry on load error */
  musicAudio.onerror = () => {
    console.warn(`[Audio] Error loading "${track.title}", skipping.`);
    if (!isFinalMode) advanceTrack();
  };

  /* Notify the UI about the track change */
  if (trackChangeCallback) {
    trackChangeCallback(track.title);
  }
}

/**
 * Advances to the next track. Wraps to index 0 after the last.
 */
function advanceTrack() {
  const next = (currentTrackIndex + 1) % playlist.length;
  prepareTrack(next);
  if (isUnlocked && !isFinalMode) {
    playMusic();
  }
}

/**
 * Attempts to play the current music track.
 * Retries with backoff if the browser rejects the play() call
 * (e.g. audio element not ready, transient failure).
 */
function playMusic(retries = 0) {
  if (!musicAudio || isFinalMode) return;

  musicAudio.play().catch((err) => {
    if (retries < MAX_RETRIES) {
      const delay = MUSIC_RETRY_MS * Math.pow(2, retries);
      console.warn(`[Audio] Play rejected, retry ${retries + 1} in ${delay}ms:`, err.message);
      setTimeout(() => playMusic(retries + 1), delay);
    } else {
      console.warn('[Audio] Max retries reached, skipping track.');
      advanceTrack();
    }
  });
}


/* ═══════════════════════════════════════════
 * TICK / TOCK (Web Audio API)
 * ═══════════════════════════════════════════
 *
 * Uses AudioContext.createBufferSource() which:
 *  - Doesn't trigger OS MediaSession notifications
 *  - Has zero DOM overhead (no HTMLAudioElement)
 *  - Provides sample-accurate timing
 *  - Is garbage collected automatically after playing
 *
 * The tick/tock alternation is tracked with a boolean.
 * Skips playback when the tab is hidden to prevent
 * CPU waste and out-of-sync sounds on tab return.
 * ═══════════════════════════════════════════ */

/**
 * Plays a single tick or tock sound via Web Audio API.
 * Called by the main tick loop on each second.
 *
 * Guards:
 *  - Skips if the tab is backgrounded
 *  - Skips if AudioContext is suspended (awaiting unlock)
 *  - Skips if buffers haven't loaded yet
 */
export function playTick() {
  /* Don't play when tab is hidden — prevents desync on return */
  if (document.hidden) return;

  /* AudioContext must be running (resumed after user gesture) */
  if (!audioCtx || audioCtx.state !== 'running') return;

  /* Buffers must be decoded */
  if (!tickBuffer || !tockBuffer) return;

  const buffer = isTickNext ? tickBuffer : tockBuffer;
  isTickNext = !isTickNext;

  /*
   * BufferSource nodes are one-shot: create, play, forget.
   * They disconnect and get GC'd automatically after playing.
   */
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  /* Route to both dry (clean) and wet (reverb) paths */
  source.connect(dryGain);
  source.connect(reverbDelay);
  source.start(0);
}

/**
 * Resets the tick/tock alternation.
 * Called when returning from a backgrounded tab so the
 * first audible tick is always a "tick" (not randomly
 * a tock from wherever the counter left off).
 */
export function resetTickPhase() {
  isTickNext = true;
}


/* ═══════════════════════════════════════════
 * FINAL COUNTDOWN
 * ═══════════════════════════════════════════ */

/**
 * Checks if the final countdown track should start.
 * The track is synced so it ENDS at exactly 0 remaining.
 *
 * If the user loads the page mid-final-window, the track
 * seeks to (trackDuration - remaining) so it still ends
 * at zero.
 *
 * @param {number} totalRemainingMs - Milliseconds until release
 */
export function checkFinalCountdown(totalRemainingMs) {
  if (isFinalMode || !isUnlocked || !finalAudio) return;

  const remainingSec = totalRemainingMs / 1000;
  if (remainingSec > finalTrack.duration) return;

  /* Enter final mode */
  isFinalMode = true;
  const seekTo = finalTrack.duration - remainingSec;
  console.log(`[Audio] FINAL COUNTDOWN — seeking to ${seekTo.toFixed(1)}s, ${remainingSec.toFixed(1)}s remaining`);

  /* Crossfade background music out */
  if (musicAudio && !musicAudio.paused) {
    fadeVolume(musicAudio, musicAudio.volume, 0, CROSSFADE_MS, () => {
      musicAudio.pause();
    });
  }

  /* Start the final track at the calculated position */
  finalAudio.currentTime = Math.max(0, seekTo);
  finalAudio.volume = 0;
  finalAudio.play().then(() => {
    fadeVolume(finalAudio, 0, FINAL_VOLUME, CROSSFADE_MS);
  }).catch((err) => {
    console.warn('[Audio] Final track failed:', err);
  });
}


/* ═══════════════════════════════════════════
 * VOLUME FADING
 * ═══════════════════════════════════════════ */

/**
 * Smoothly transitions an audio element's volume.
 * Uses linear interpolation over FADE_STEPS intervals.
 *
 * @param {HTMLAudioElement} audio
 * @param {number} from - Starting volume
 * @param {number} to - Target volume
 * @param {number} durationMs - Fade duration
 * @param {Function} [onComplete] - Called when fade finishes
 */
function fadeVolume(audio, from, to, durationMs, onComplete) {
  const stepMs = durationMs / FADE_STEPS;
  const stepSize = (to - from) / FADE_STEPS;
  let step = 0;

  const interval = setInterval(() => {
    step++;
    audio.volume = Math.max(0, Math.min(1, from + stepSize * step));

    if (step >= FADE_STEPS) {
      clearInterval(interval);
      audio.volume = Math.max(0, Math.min(1, to));
      if (onComplete) onComplete();
    }
  }, stepMs);
}


/* ═══════════════════════════════════════════
 * AUTOPLAY UNLOCK
 * ═══════════════════════════════════════════
 *
 * Browsers block both HTMLAudioElement.play() and
 * AudioContext.resume() until a user gesture. We
 * listen for the first interaction and unlock both.
 * ═══════════════════════════════════════════ */

function setupAutoplayUnlock() {
  const events = ['click', 'touchstart', 'keydown'];

  function unlock() {
    if (isUnlocked) return;
    isUnlocked = true;

    /* Remove listeners — one unlock is enough */
    events.forEach((e) => document.removeEventListener(e, unlock, { capture: true }));

    /* Resume the AudioContext (required for tick/tock) */
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => {
        console.log('[Audio] AudioContext resumed.');
      });
    }

    /* Start background music */
    playMusic();

    console.log('[Audio] Unlocked by user gesture.');
  }

  events.forEach((e) => {
    document.addEventListener(e, unlock, { capture: true, passive: true });
  });
}


/* ═══════════════════════════════════════════
 * MUTE / UNMUTE
 * ═══════════════════════════════════════════ */

/**
 * Toggles mute state for all audio.
 * Music and final track fade smoothly.
 * Tick/tock gain snaps immediately (they're transient).
 *
 * @returns {boolean} The new muted state
 */
export function toggleMute() {
  isMuted = !isMuted;

  /* Music volume */
  if (musicAudio) {
    musicAudio.volume = isMuted ? 0 : MUSIC_VOLUME;
  }

  /* Final countdown volume */
  if (finalAudio) {
    finalAudio.volume = isMuted ? 0 : FINAL_VOLUME;
  }

  /* Tick/tock dry + wet gains */
  if (dryGain) {
    dryGain.gain.value = isMuted ? 0 : TICK_VOLUME;
  }
  if (wetGain) {
    wetGain.gain.value = isMuted ? 0 : TICK_VOLUME * REVERB_WET_MIX;
  }

  console.log(`[Audio] ${isMuted ? 'Muted' : 'Unmuted'}`);
  return isMuted;
}


/* ═══════════════════════════════════════════
 * TRACK CHANGE NOTIFICATION
 * ═══════════════════════════════════════════ */

/**
 * Registers a callback that fires when the current
 * track changes. The callback receives the track title.
 *
 * @param {Function} callback - fn(title: string)
 */
export function onTrackChange(callback) {
  trackChangeCallback = callback;
}
