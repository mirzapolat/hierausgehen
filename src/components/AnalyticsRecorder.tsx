'use client';

import { useEffect } from 'react';
import {
  ANALYTICS_DOMAINS,
  ANALYTICS_RECORDER_SCRIPT,
  ANALYTICS_WEBSITE_ID,
} from '@/lib/analytics';

/**
 * Lädt den Umami-Rekorder für Heatmaps und Sitzungsaufzeichnungen.
 *
 * Das Skript ist deutlich schwerer als die reine Zählung, darum kommt es erst
 * nach dem Laden der Seite dazu. Die Erlaubnisliste aus `ANALYTICS_DOMAINS`
 * wird hier von Hand geprüft: der Rekorder bringt – anders als `script.js` –
 * kein `data-domains` mit und würde sonst auch lokale Läufe aufzeichnen.
 */
export function AnalyticsRecorder() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;

    const allowed = ANALYTICS_DOMAINS.split(',').map((domain) => domain.trim());
    if (!allowed.includes(window.location.hostname)) return;

    // Der Effekt läuft im Entwicklungsmodus zweimal; ein zweites Skript
    // würde doppelt aufzeichnen.
    const selector = `script[src="${ANALYTICS_RECORDER_SCRIPT}"]`;
    if (document.querySelector(selector)) return;

    const load = () => {
      if (document.querySelector(selector)) return;
      const script = document.createElement('script');
      script.src = ANALYTICS_RECORDER_SCRIPT;
      script.defer = true;
      script.dataset.websiteId = ANALYTICS_WEBSITE_ID;
      document.head.appendChild(script);
    };

    if (document.readyState === 'complete') load();
    else {
      window.addEventListener('load', load, { once: true });
      return () => window.removeEventListener('load', load);
    }
  }, []);

  return null;
}
