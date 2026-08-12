/**
 * ═══════════════════════════════════════════════════════
 * GTA VI COUNTDOWN — PWA Registration
 * ═══════════════════════════════════════════════════════
 *
 * Registers the service worker for offline support and
 * PWA installability. Handles update notifications and
 * graceful fallbacks.
 *
 * @module pwa
 */


/**
 * Registers the service worker.
 *
 * The service worker file is in /public/sw.js and will
 * be served from the root. Vite doesn't process files
 * in the public directory, so the SW runs as-is.
 *
 * We check for SW support first — older browsers or
 * certain webviews don't support service workers.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service workers not supported in this browser.');
    return;
  }

  /*
   * Register after the page has fully loaded.
   * This avoids competing with critical resource
   * downloads during initial page load.
   */
  window.addEventListener('load', async () => {
    try {
      const swUrl = import.meta.env.DEV ? '/src/sw.js' : '/sw.js';
      // eslint-disable-next-line compat/compat
      const registration = await navigator.serviceWorker.register(swUrl, {
        scope: '/',
      });

      console.log('[PWA] Service worker registered:', registration.scope);

      /*
       * Listen for updates to the service worker.
       * When a new SW is found, it enters the "waiting"
       * state until all tabs are closed. We can prompt
       * the user to refresh.
       */
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (
            newWorker.state === 'activated' &&
            navigator.serviceWorker.controller
          ) {
            console.log('[PWA] New version available. Refresh to update.');
          }
        });
      });
    } catch (error) {
      console.error('[PWA] Service worker registration failed:', error);
    }
  });
}
