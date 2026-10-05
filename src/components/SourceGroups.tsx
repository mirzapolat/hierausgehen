'use client';

import { useMemo, type CSSProperties } from 'react';
import { GROUP_COLORS, groupColor, inkOn, type EventGroup } from '@/lib/events/groups';
import { groupState } from '@/lib/events/source-selection';
import type { SourceDefinition, SourceResult } from '@/lib/events/types';
import { useSettings } from '@/lib/settings/context';
import { SourceIcon } from './SourceIcon';
import { Check, Warning } from './icons';

interface Props {
  definitions: SourceDefinition[];
  status: SourceResult[];
  /** Gewählte Quellen; leer = alle. */
  selected: ReadonlySet<string>;
  onToggleGroup: (group: EventGroup) => void;
  onToggleSource: (id: string) => void;
}

/** So viele Favicons stehen gestapelt auf einer Kachel. */
const ICON_STACK = 4;

/**
 * Die Quellen als Ordner: eine Kachel je Ordner in zwei Spalten, ein Klick
 * wählt den ganzen Ordner. Die einzelnen Häuser kommen erst, wenn sie etwas
 * zu sagen haben – unter den Kacheln, für jeden gewählten Ordner eine Zeile
 * zum Eingrenzen (siehe `toggleSource`). Ohne Wahl bleibt es bei den Kacheln.
 */
export function SourceGroups({ definitions, status, selected, onToggleGroup, onToggleSource }: Props) {
  const { t, term, settings, format } = useSettings();
  const statusById = useMemo(() => new Map(status.map((s) => [s.sourceId, s])), [status]);

  // Ordner in der festen Reihenfolge ihrer Farben, Häuser darin alphabetisch.
  const groups = useMemo(() => {
    const order = Object.keys(GROUP_COLORS) as EventGroup[];
    return order
      .map((group) => ({
        group,
        sources: definitions
          .filter((d) => d.group === group)
          .sort((a, b) => a.name.localeCompare(b.name, settings.locale)),
      }))
      .filter((entry) => entry.sources.length > 0)
      .map((entry) => ({ ...entry, state: groupState(selected, entry.sources.map((s) => s.id)) }));
  }, [definitions, selected, settings.locale]);

  const ailing = (id: string) => {
    const info = statusById.get(id);
    return info?.status === 'stale' || info?.status === 'error' ? info : undefined;
  };
  // Auch ein Ordner mit nur einem Haus zeigt es – man soll sehen, wer dahintersteht.
  const refining = groups.filter((entry) => entry.state !== 'none');
  // Ist etwas gewählt, treten die übrigen Kacheln zurück – ihre Farbe bleibt.
  const dimmed = groups.some((entry) => entry.state !== 'none');

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-1.5">
        {groups.map(({ group, sources, state }) => {
          const color = groupColor(group);
          const chosen = sources.filter((s) => selected.has(s.id)).length;
          return (
            <button
              key={group}
              type="button"
              aria-pressed={state === 'all' ? true : state === 'some' ? 'mixed' : false}
              onClick={() => onToggleGroup(group)}
              style={{ background: color, color: inkOn(color) }}
              className={`flex min-h-[76px] min-w-0 flex-col justify-between gap-2 rounded-[var(--radius-lg)]
                          p-2.5 text-left transition-[opacity,filter] hover:brightness-110
                          ${state === 'none' ? '' : 'ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--chrome)]'}
                          ${dimmed && state === 'none' ? 'opacity-40 hover:opacity-75' : ''}`}
            >
              <span className="flex items-center justify-between">
                {/* Die Häuser darin als kleiner Stapel – man sieht, wer dazugehört. */}
                <span aria-hidden="true" className="flex items-center gap-1">
                  {sources.slice(0, ICON_STACK).map((source) => (
                    <SourceIcon key={source.id} source={source} size={14} />
                  ))}
                </span>
                {state === 'all' && <Check className="h-4 w-4" />}
                {state === 'some' && (
                  <span className="text-[11px] font-semibold tabular-nums">
                    {chosen}/{sources.length}
                  </span>
                )}
                {state === 'none' && sources.some((s) => ailing(s.id)) && <Warning className="h-3.5 w-3.5" />}
              </span>
              <span className="line-clamp-2 text-[14px] font-bold leading-tight tracking-[-0.01em]">
                {term(group)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Eingrenzen: die Häuser jedes gewählten Ordners. Solange der Ordner
          ganz gewählt ist, sind alle Häuser „an“ – der erste Tipp auf eines
          grenzt auf dieses ein. */}
      {refining.map(({ group, sources, state }) => {
        const color = groupColor(group);
        return (
          <div key={group}>
            <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] text-faint">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-[2px]" style={{ background: color }} />
              {/* Mit nur einem Haus gibt es nichts einzugrenzen – dann nur der Name. */}
              {state === 'all' && sources.length > 1 ? t('refineGroup', { group: term(group) }) : term(group)}
            </p>
            <div className="flex flex-wrap gap-1">
              {sources.map((source) => {
                const on = selected.has(source.id);
                const info = ailing(source.id);
                return (
                  <button
                    key={source.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggleSource(source.id)}
                    title={
                      info
                        ? info.status === 'stale'
                          ? t('asOf', { time: format.stamp(info.fetchedAt) })
                          : (info.error ?? '')
                        : undefined
                    }
                    style={pillStyle(color, state === 'all' ? 'implied' : on ? 'on' : 'off')}
                    className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-2.5
                               text-[13px] transition-colors lg:py-[3px] lg:text-[12px]"
                  >
                    <SourceIcon source={source} size={12} />
                    <span className="truncate">{source.name}</span>
                    {info && <Warning className="h-3 w-3 shrink-0 text-[var(--danger)]" />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}


/** Haus: „implied“ heisst, es gilt, weil der ganze Ordner gewählt ist. */
function pillStyle(color: string, state: 'implied' | 'on' | 'off'): CSSProperties {
  if (state === 'off') return { borderColor: 'var(--line)', color: 'var(--text-faint)' };
  if (state === 'implied') {
    return { borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, color: 'var(--text-muted)' };
  }
  return {
    borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
    background: `color-mix(in srgb, ${color} 16%, transparent)`,
    color: 'var(--text)',
  };
}
