'use client';

import { useEffect } from 'react';

/**
 * Meldet den Service Worker an. Er speichert nur das Gerüst der App zwischen –
 * Termine kommen weiterhin immer aus dem Netz.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('[pwa] Service Worker nicht registriert', error);
      });
    };

    // Erst nach dem Laden anmelden, damit die Anmeldung nichts verzögert.
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
