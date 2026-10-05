'use client';

import { useEffect, useRef } from 'react';
import { DETAIL_KEY, SIDEBAR_KEY, useKeyLabel } from '@/lib/keyboard';
import { useSettings } from '@/lib/settings/context';
import { useOverlayTransition } from '@/lib/useOverlayTransition';
import type { MessageKey } from '@/lib/i18n';
import { Close } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Row {
  label: MessageKey;
  /** Feste Beschriftung – für alles, was auf jedem Layout gleich heisst. */
  keys?: string[];
  /**
   * Kürzel auf einer Taste, deren Zeichen vom Tastaturlayout abhängt. Die
   * Beschriftung wird erst im Browser aufgelöst (siehe `@/lib/keyboard`).
   */
  layoutKey?: 'sidebar' | 'detail';
}

/** Gruppen genau in der Reihenfolge, in der man sie beim Arbeiten braucht. */
const groups: { title: MessageKey; rows: Row[] }[] = [
  {
    title: 'shortcutsNavigation',
    rows: [
      { keys: ['←', '→'], label: 'scStep' },
      { keys: ['↑', '↓'], label: 'scEvent' },
      { keys: ['T'], label: 'scToday' },
      { keys: ['O'], label: 'scOpen' },
      { keys: ['S'], label: 'scSave' },
    ],
  },
  {
    title: 'shortcutsView',
    rows: [
      { keys: ['D'], label: 'day' },
      { keys: ['W'], label: 'week' },
      { keys: ['M'], label: 'month' },
      { keys: ['K'], label: 'map' },
    ],
  },
  {
    title: 'shortcutsLayout',
    rows: [
      { layoutKey: 'sidebar', label: 'scSidebar' },
      { layoutKey: 'detail', label: 'scDetail' },
      { keys: ['/'], label: 'scSearch' },
      { keys: ['Esc'], label: 'scClear' },
      { keys: ['?'], label: 'scHelp' },
    ],
  },
];

/** Übersicht der Tastenkürzel – erreichbar über „?“ und den Knopf in der Leiste. */
export function ShortcutsOverlay({ open, onClose }: Props) {
  const { t } = useSettings();
  const { mounted, shown } = useOverlayTransition(open, 160);
  const panel = useRef<HTMLDivElement>(null);

  // Auf QWERTZ liegen die Spaltenkürzel auf „Ü“ und „+“ statt auf „[“ und
  // „]“ – dieselbe Stelle der Tastatur, ein anderes Zeichen darauf.
  const layoutKeys = {
    sidebar: useKeyLabel(SIDEBAR_KEY),
    detail: useKeyLabel(DETAIL_KEY),
  };

  useEffect(() => {
    if (mounted) panel.current?.focus({ preventScroll: true });
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label={t('close')}
        onClick={onClose}
        className={`absolute inset-0 transition-opacity duration-160 ${shown ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'var(--overlay)' }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts')}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          onClose();
        }}
        className={`relative w-full max-w-[520px] rounded-[var(--radius-lg)] border border-line
                    bg-[var(--raised)] outline-none transition-[opacity,transform] duration-160 ease-out
                    ${shown ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0'}`}
        style={{ boxShadow: 'var(--shadow-overlay)' }}
      >
        <div className="flex h-12 items-center justify-between px-4 hairline-b">
          <h2 className="text-[13px] font-semibold">{t('shortcuts')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-muted hover:text-text"
          >
            <Close />
          </button>
        </div>

        <div className="grid gap-x-8 gap-y-5 px-4 py-4 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
                {t(group.title)}
              </h3>
              <dl className="flex flex-col">
                {group.rows.map((row) => (
                  <div key={row.label} className="flex items-center gap-3 py-[3px]">
                    <dt className="flex shrink-0 gap-1">
                      {(row.layoutKey ? [layoutKeys[row.layoutKey]] : (row.keys ?? [])).map((key) => (
                        <kbd
                          key={key}
                          className="grid h-[20px] min-w-[20px] place-items-center rounded-[var(--radius-xs)]
                                     border border-line bg-[var(--canvas)] px-1 text-[11px] font-medium
                                     text-muted"
                        >
                          {key}
                        </kbd>
                      ))}
                    </dt>
                    <dd className="min-w-0 flex-1 text-[12px] text-muted">{t(row.label)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="px-4 pb-4 text-[12px] text-faint">{t('scContext')}</p>
      </div>
    </div>
  );
}
