/**
 * ═══════════════════════════════════════════════════════
 * GTA VI COUNTDOWN — Countdown Engine
 * ═══════════════════════════════════════════════════════
 *
 * Pure computation module — no DOM, no side effects.
 * Calculates the remaining time until GTA VI release,
 * broken down into months, days, hours, minutes, seconds.
 *
 * Release: November 19, 2026 at midnight local time.
 * Rockstar uses rolling midnight releases per timezone.
 *
 * @module countdown
 */

const RELEASE_YEAR  = 2026;
const RELEASE_MONTH = 10;  /* November (JS months are 0-indexed) */
const RELEASE_DAY   = 19;

/* Time unit constants */
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = MS_PER_SECOND * 60;
const MS_PER_HOUR   = MS_PER_MINUTE * 60;
const MS_PER_DAY    = MS_PER_HOUR * 24;

/**
 * Build the target Date object in the user's local timezone.
 * Constructed once and reused — the release date doesn't change.
 */
const RELEASE_DATE = new Date(RELEASE_YEAR, RELEASE_MONTH, RELEASE_DAY, 0, 0, 0);


/**
 * Calculates the full time remaining until release.
 *
 * Months are calculated as calendar months (not fixed 30-day blocks).
 * The remaining days represent the leftover after full months,
 * so "3 months, 9 days" means exactly 3 calendar months + 9 days.
 *
 * @returns {{months: number, days: number, hours: number,
 *            minutes: number, seconds: number, total: number,
 *            released: boolean}}
 */
export function getTimeRemaining() {
  const now = new Date();
  const totalMs = RELEASE_DATE.getTime() - now.getTime();

  /* Already released — zero everything out */
  if (totalMs <= 0) {
    return { months: 0, days: 0, hours: 0, minutes: 0, seconds: 0, total: 0, released: true };
  }

  /*
   * Calculate full calendar months between now and release.
   *
   * Start with the raw month difference, then check if we've
   * overshot. If adding `months` months to `now` goes past the
   * release date, we subtract one month.
   */
  let months = (RELEASE_DATE.getFullYear() - now.getFullYear()) * 12
             + (RELEASE_DATE.getMonth() - now.getMonth());

  /* Clone `now` and advance by `months` months */
  let checkpoint = new Date(now);
  checkpoint.setMonth(checkpoint.getMonth() + months);

  /* If we overshot, back off one month */
  if (checkpoint > RELEASE_DATE) {
    months--;
    checkpoint = new Date(now);
    checkpoint.setMonth(checkpoint.getMonth() + months);
  }

  /* Everything after the full months is broken into day/hour/min/sec */
  const remainderMs = RELEASE_DATE.getTime() - checkpoint.getTime();

  const days    = Math.floor(remainderMs / MS_PER_DAY);
  const hours   = Math.floor((remainderMs % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((remainderMs % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((remainderMs % MS_PER_MINUTE) / MS_PER_SECOND);

  return { months, days, hours, minutes, seconds, total: totalMs, released: false };
}


/**
 * Formats a numeric value with leading zeroes for display.
 *
 * @param {number} value - The number to format
 * @param {string} unit  - Unit name (determines padding width)
 * @returns {string} Zero-padded string
 */
export function formatUnit(value, unit) {
  /* Months and days get 2 digits; time units also get 2 */
  return String(value).padStart(2, '0');
}
