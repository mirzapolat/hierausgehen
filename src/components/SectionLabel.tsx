'use client';

import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Mit `onToggle` wird die Marke zum Knopf, der den Abschnitt ein- und ausklappt. */
  expanded?: boolean;
  onToggle?: () => void;
  /** Wie viele Einträge der eingeklappte Abschnitt verbirgt. */
  count?: number;
}

/**
 * Abschnittsname als kleine, mittig gesetzte Marke auf gedecktem Grund –
 * ohne Linie darüber oder darunter. Der Weissraum trennt die Abschnitte, die
 * Marke sagt nur, was folgt. Dieselbe Marke steht über den Abschnitten der
 * Tagesvorschau und in der Detailansicht eines Termins.
 */
export function SectionLabel({ children, expanded = true, onToggle, count }: Props) {
  const label =
    'inline-flex items-center gap-1.5 rounded-full bg-[var(--sunken)] px-2.5 py-[3px] text-[10px] ' +
    'font-medium uppercase tracking-[0.08em] text-muted';

  return (
    <h3 className="flex justify-center px-4 pb-1.5 pt-3">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className={`${label} transition-colors hover:text-text`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 8 8"
            className={`h-[7px] w-[7px] transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M2 1 L6.5 4 L2 7 Z" fill="currentColor" />
          </svg>
          {children}
          {!expanded && count !== undefined && <span className="tabular-nums text-faint">{count}</span>}
        </button>
      ) : (
        <span className={label}>{children}</span>
      )}
    </h3>
  );
}
