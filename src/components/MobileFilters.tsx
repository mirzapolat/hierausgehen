'use client';

import type { ReactNode } from 'react';
import { useSettings } from '@/lib/settings/context';
import { useOverlayTransition } from '@/lib/useOverlayTransition';
import { Close } from './icons';
import { MOTION, MOTION_MS } from './motion';

interface Props {
  open: boolean;
  onClose: () => void;
  activeFilterCount: number;
  onReset: () => void;
  /** Die Filterspalte – dieselbe wie am Schreibtisch. */
  children: ReactNode;
}

/** Mobil: die Filter als Overlay, das von links hereinfährt. */
export function MobileFilters({ open, onClose, activeFilterCount, onReset, children }: Props) {
  const { t } = useSettings();
  const overlay = useOverlayTransition(open, MOTION_MS);
  if (!overlay.mounted) return null;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        type="button"
        aria-label={t('closeFilters')}
        onClick={onClose}
        className={`absolute inset-0 transition-opacity ${MOTION}
                    ${overlay.shown ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'var(--overlay)' }}
      />
      <div
        className={`absolute inset-y-0 left-0 flex w-[88%] max-w-[360px] flex-col bg-[var(--chrome)]
                    transition-transform ${MOTION}
                    ${overlay.shown ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ boxShadow: 'var(--shadow-overlay)' }}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-3 pl-4 hairline-b">
          <span className="text-[15px] font-semibold">{t('filters')}</span>
          {activeFilterCount > 0 && (
            <span
              className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--accent-soft)]
                         px-1.5 text-[11px] font-medium tabular-nums text-accent"
            >
              {activeFilterCount}
            </span>
          )}
          {/* Ein Weg zurück auf den unberührten Bestand – auf dem Finger ist
              das Einsammeln einzelner Filter sonst mühsam. */}
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="ml-auto rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] text-muted
                         hover:bg-[var(--canvas)] hover:text-text"
            >
              {t('resetFilters')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className={`grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] text-muted
                        hover:bg-[var(--canvas)] hover:text-text
                        ${activeFilterCount > 0 ? '' : 'ml-auto'}`}
          >
            <Close />
          </button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
