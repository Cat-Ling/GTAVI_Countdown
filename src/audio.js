/**
 * ═══════════════════════════════════════════════════════
 * GTA VI COUNTDOWN — Audio Engine (Pure Web Audio API)
 * ═══════════════════════════════════════════════════════
 *
 * Three independent audio systems all unified under a single
 * Web Audio API AudioContext. By completely avoiding HTMLAudioElement,
 * we hide entirely from the iOS system media player hijacker, preventing
 * the lock screen "Now Playing" widget from showing up and preventing
 * background audio from dropping our clock ticks!
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
const FADE_STEPS      = 30; // Kept for legacy fadeVolume fallback if needed, but we use linearRamp

const REVERB_DECAY    = 2.0;    /* Reverb tail length in seconds */
const REVERB_WET_MIX  = 0.6;    /* Wet signal level relative to dry */

/* ═══════════════════════════════════════════
 * STATE
 * ═══════════════════════════════════════════ */

let playlist          = [];
let currentTrackIndex = 0;
let finalTrack        = { file: '', duration: 0 };

let isUnlocked        = false;
let isFinalMode       = false;
let isTickNext        = true;
let isMuted           = localStorage.getItem('gtavi_muted') === 'true';

/* Callbacks for UI updates */
let trackChangeCallback = null;
let unlockCallback      = null;

/* Web Audio API Core */
let audioCtx          = null;

/* Tick/Tock Nodes */
let tickBuffer        = null;
let tockBuffer        = null;
let dryGain           = null;
let wetGain           = null;
let convolver         = null;

/* Music Player Nodes */
const trackBuffers    = new Map(); /* Cache decoded music buffers */
let currentMusicBuffer= null;
let musicSource       = null;
let musicGain         = null;

/* Final Countdown Nodes */
let finalBuffer       = null;
let finalSource       = null;
let finalGain         = null;


/* ═══════════════════════════════════════════
 * INITIALIZATION
 * ═══════════════════════════════════════════ */

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function fetchAudioBuffer(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return audioCtx.decodeAudioData(arrayBuffer);
}

function generateImpulseResponse(ctx, duration) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  
  for (let channel = 0; channel < 2; channel++) {
    const channelData = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const noise = (Math.random() * 2) - 1;
      const decay = Math.pow(1 - i / length, 3.0);
      channelData[i] = noise * decay;
    }
  }
  return impulse;
}

export async function initAudio() {
  try {
    const response = await fetch('/audio/playlist.json');
    const data = await response.json();

    playlist = shuffle([...data.playlist]);
    finalTrack = data.finalCountdown;

    /* Single Context for everything */
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    /* Set up Tick/Tock Reverb Network */
    dryGain = audioCtx.createGain();
    dryGain.gain.value = TICK_VOLUME;
    dryGain.connect(audioCtx.destination);

    convolver = audioCtx.createConvolver();
    convolver.buffer = generateImpulseResponse(audioCtx, REVERB_DECAY);

    wetGain = audioCtx.createGain();
    wetGain.gain.value = TICK_VOLUME * REVERB_WET_MIX;
    
    convolver.connect(wetGain);
    wetGain.connect(audioCtx.destination);

    /* Decode tick/tock into reusable buffers */
    const [tick, tock] = await Promise.all([
      fetchAudioBuffer(data.countdown.tick),
      fetchAudioBuffer(data.countdown.tock),
    ]);
    tickBuffer = tick;
    tockBuffer = tock;

    /* Prepare Music Nodes */
    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0; // Starts silent until unlocked
    musicGain.connect(audioCtx.destination);

    finalGain = audioCtx.createGain();
    finalGain.gain.value = 0;
    finalGain.connect(audioCtx.destination);

    /* Preload the first track in the background */
    prepareTrack(0);
    
    /* Preload the final track in the background */
    fetchAudioBuffer(finalTrack.file).then(buf => {
      finalBuffer = buf;
    }).catch(err => console.warn('[Audio] Failed to preload final track:', err));

    setupAutoplayUnlock();

    console.log(`[Audio] Ready. Shuffled ${playlist.length} tracks. First: "${playlist[0].title}"`);
  } catch (error) {
    console.warn('[Audio] Init failed:', error);
  }
}

/* ═══════════════════════════════════════════
 * MUSIC PLAYER (Pure Web Audio)
 * ═══════════════════════════════════════════ */

async function prepareTrack(index) {
  currentTrackIndex = index;
  const track = playlist[index];

  /* Notify UI immediately so the user knows what's loading */
  if (trackChangeCallback) {
    trackChangeCallback(track.title);
  }

  try {
    let buffer;
    if (trackBuffers.has(track.file)) {
      buffer = trackBuffers.get(track.file);
    } else {
      buffer = await fetchAudioBuffer(track.file);
      trackBuffers.set(track.file, buffer);
    }

    /* If we switched tracks before this finished loading, abort playing it */
    if (currentTrackIndex !== index) return;

    currentMusicBuffer = buffer;

    /* If we are unlocked and not in final mode, start playing immediately! */
    if (isUnlocked && !isFinalMode) {
      playMusic();
    }
  } catch (err) {
    console.warn(`[Audio] Error loading "${track.title}", skipping.`, err);
    if (!isFinalMode) advanceTrack();
  }
}

function advanceTrack() {
  const next = (currentTrackIndex + 1) % playlist.length;
  prepareTrack(next);
}

function playMusic() {
  if (isFinalMode || !currentMusicBuffer || !audioCtx) return;

  /* Stop existing source if it's playing */
  if (musicSource) {
    musicSource.onended = null;
    musicSource.stop();
    musicSource.disconnect();
    musicSource = null;
  }

  /* Create new one-shot buffer source */
  musicSource = audioCtx.createBufferSource();
  musicSource.buffer = currentMusicBuffer;
  musicSource.connect(musicGain);

  musicSource.onended = () => {
    if (!isFinalMode) advanceTrack();
  };

  musicSource.start(0);

  /* Smoothly ramp volume up to target */
  const now = audioCtx.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(musicGain.gain.value, now);
  musicGain.gain.linearRampToValueAtTime(isMuted ? 0 : MUSIC_VOLUME, now + 1.0);
}


/* ═══════════════════════════════════════════
 * TICK / TOCK
 * ═══════════════════════════════════════════ */

export function playTick() {
  if (document.hidden || !audioCtx) return;

  /* Aggressively resume if OS suspended the context */
  if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
    audioCtx.resume().catch(() => {});
  }

  if (!tickBuffer || !tockBuffer) return;

  const buffer = isTickNext ? tickBuffer : tockBuffer;
  isTickNext = !isTickNext;

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(dryGain);
  source.connect(convolver);
  source.start(0);
}

export function resetTickPhase() {
  isTickNext = true;
}


/* ═══════════════════════════════════════════
 * FINAL COUNTDOWN
 * ═══════════════════════════════════════════ */

export function checkFinalCountdown(totalRemainingMs) {
  if (isFinalMode || !isUnlocked || !finalBuffer || !audioCtx) return;

  const remainingSec = totalRemainingMs / 1000;
  if (remainingSec > finalTrack.duration) return;

  isFinalMode = true;
  const seekTo = finalTrack.duration - remainingSec;
  console.log(`[Audio] FINAL COUNTDOWN — seeking to ${seekTo.toFixed(1)}s, ${remainingSec.toFixed(1)}s remaining`);

  const now = audioCtx.currentTime;

  /* Crossfade background music out */
  if (musicSource) {
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(0, now + (CROSSFADE_MS / 1000));
    
    setTimeout(() => {
      if (musicSource) {
        musicSource.onended = null;
        musicSource.stop();
        musicSource.disconnect();
        musicSource = null;
      }
    }, CROSSFADE_MS);
  }

  /* Start the final track at the calculated position */
  finalSource = audioCtx.createBufferSource();
  finalSource.buffer = finalBuffer;
  finalSource.connect(finalGain);
  
  finalSource.start(0, Math.max(0, seekTo));

  finalGain.gain.cancelScheduledValues(now);
  finalGain.gain.setValueAtTime(0, now);
  finalGain.gain.linearRampToValueAtTime(FINAL_VOLUME, now + (CROSSFADE_MS / 1000));
}


/* ═══════════════════════════════════════════
 * AUTOPLAY UNLOCK
 * ═══════════════════════════════════════════ */

function setupAutoplayUnlock() {
  const events = ['click', 'touchstart', 'keydown'];

  function unlock() {
    if (isUnlocked) return;
    isUnlocked = true;

    events.forEach((e) => document.removeEventListener(e, unlock, { capture: true }));

    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => {
        console.log('[Audio] AudioContext resumed.');
      });
    }

    /* Start music if it's already decoded and ready */
    if (currentMusicBuffer) {
      playMusic();
    }

    console.log('[Audio] Unlocked by user gesture.');
    
    if (unlockCallback) {
      unlockCallback();
    }
  }

  events.forEach((e) => {
    document.addEventListener(e, unlock, { capture: true, passive: true });
  });
}


/* ═══════════════════════════════════════════
 * EXPORTS / EVENT BINDING
 * ═══════════════════════════════════════════ */

export function toggleMute() {
  isMuted = !isMuted;
  localStorage.setItem('gtavi_muted', isMuted);

  if (!audioCtx) return isMuted;

  const now = audioCtx.currentTime;
  
  /* Instantly ramp music volume */
  if (musicGain) {
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(isMuted ? 0 : MUSIC_VOLUME, now + 0.3);
  }

  /* Note: Tick/tock volume is unaffected by the music mute button, keeping UI alive! */
  return isMuted;
}

export function onTrackChange(callback) {
  trackChangeCallback = callback;
}

export function onUnlock(callback) {
  unlockCallback = callback;
}

export function getMuteState() {
  return isMuted;
}

export function isAudioUnlocked() {
  return isUnlocked;
}
