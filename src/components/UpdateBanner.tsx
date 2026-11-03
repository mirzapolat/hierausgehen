'use client';

import { useEffect, useState } from 'react';
import { useSettings } from '@/lib/settings/context';
import { Close } from './icons';

/** So oft fragt eine offene App nach, ob neu ausgeliefert wurde. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

/**
 * Hinweis, dass eine neuere Fassung der App ausgeliefert wurde.
 *
 * Vom Startbildschirm geöffnet läuft die App oft tagelang weiter, ohne je neu
 * geladen zu werden. Sie fragt deshalb beim Zurückholen in den Vordergrund
 * und in Abständen nach der Kennung des Servers (`/api/version`); weicht sie
 * von der eigenen ab, steht unten ein schmaler Hinweis mit „Neu laden“. Im
 * Browser-Tab lädt man ohnehin neu, dort bleibt er aus.
 */
export function UpdateBanner() {
  const { t } = useSettings();
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!standalone) return;

    const current = process.env.NEXT_PUBLIC_BUILD_ID;
    let stopped = false;

    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch('/api/version', { cache: 'no-store' });
        if (!response.ok) return;
        const { build } = (await response.json()) as { build?: string };
        if (!stopped && build && build !== current) setAvailable(true);
      } catch {
        // Ohne Netz gibt es nichts zu melden.
      }
    };

    void check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  if (!available || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
    >
      <div
        className="flex items-center gap-1 rounded-[var(--radius-lg)] border border-line bg-[var(--raised)]
                   py-1 pl-3.5 pr-1 text-[14px] text-text"
        style={{ boxShadow: 'var(--shadow-overlay)' }}
      >
        <span className="mr-2">{t('updateAvailable')}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-9 rounded-[var(--radius-md)] bg-[var(--accent)] px-3 text-[14px] font-medium text-white"
        >
          {t('updateReload')}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t('close')}
          className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-muted"
        >
          <Close />
        </button>
      </div>
    </div>
  );
}
