import '@fontsource/outfit/300.css';
import '@fontsource/outfit/700.css';
import '@fontsource/jetbrains-mono/700.css';

import { getTimeRemaining, setTimezone, currentTargetMode, checkReleaseStates } from './countdown.js';

const UNITS = ['months', 'days', 'hours', 'minutes', 'seconds'];
const elements = {};
let previousValues = {};
let rAFId = null;

function init() {
  UNITS.forEach(unit => {
    elements[unit] = document.querySelector(`.countdown__value[data-unit="${unit}"]`);
  });

  setupTimezoneToggle();
  startTick();
  
  // Make timer visible
  const cd = document.getElementById('countdown');
  if (cd) cd.classList.add('countdown--visible');
}

function updateDisplay(time) {
  UNITS.forEach(unit => {
    const formatted = String(time[unit]).padStart(2, '0');
    if (previousValues[unit] === formatted) return;
    
    if (elements[unit]) {
      elements[unit].textContent = formatted;
    }
    previousValues[unit] = formatted;
  });
}

function tickLoop() {
  const time = getTimeRemaining();
  
  if (time.released) {
    // If it's released, check if we need to show a fallback
    const states = checkReleaseStates();
    if (states.isUKReleased && !states.isLocalReleased && currentTargetMode === 'UK') {
      document.querySelector('.embed-wrapper').innerHTML = `
        <div style="text-align: center; color: var(--color-text);">
          <h1 style="font-family: var(--font-display); font-size: 2rem; font-weight: 700;">AVAILABLE NOW</h1>
          <p style="font-family: var(--font-display); margin-top: 1rem; color: var(--color-text-muted);">
            Wait, I want to track my local time!<br>
            <button id="released-timezone-btn" type="button" style="margin-top: 0.5rem; background: none; border: none; font-size: 1.2rem; font-weight: 700; cursor: pointer; color: var(--color-hot-pink);">Switch to Local</button>
          </p>
        </div>
      `;
      document.getElementById('released-timezone-btn').addEventListener('click', () => {
        localStorage.setItem('gtavi_timezone_mode', 'local');
        window.location.reload();
      });
    } else {
      document.querySelector('.embed-wrapper').innerHTML = `
        <div style="text-align: center;">
          <h1 style="font-family: var(--font-display); font-size: clamp(2rem, 8vw, 4rem); font-weight: 700; color: var(--color-text); letter-spacing: 0.05em;">AVAILABLE NOW</h1>
        </div>
      `;
    }
    return; // Stop the loop
  }
  
  updateDisplay(time);
  rAFId = requestAnimationFrame(tickLoop);
}

function startTick() {
  if (rAFId === null) {
    rAFId = requestAnimationFrame(tickLoop);
  }
}

function setupTimezoneToggle() {
  const btn = document.getElementById('timezone-toggle');
  if (!btn) return;
  
  const savedMode = localStorage.getItem('gtavi_timezone_mode') || 'UK';
  if (savedMode !== currentTargetMode) {
    setTimezone(savedMode);
  }
  btn.textContent = savedMode;
  
  btn.addEventListener('click', () => {
    const newMode = currentTargetMode === 'UK' ? 'local' : 'UK';
    setTimezone(newMode);
    btn.textContent = newMode;
    localStorage.setItem('gtavi_timezone_mode', newMode);
    
    // Force immediate update
    updateDisplay(getTimeRemaining());
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
