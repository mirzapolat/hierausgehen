'use client';

import { useMemo, type CSSProperties } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import {
  availabilityKeys,
  displayAvailability,
  runningUntil,
  sourceColor,
  sourceName,
} from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { AvailabilityDot } from './AvailabilityDot';
import { SourceIcon } from './SourceIcon';

interface Props {
  /** Der gezeigte Tag – Mehrtägiges, das schon läuft, trägt „bis …". */
  day: string;
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedEventId?: string;
  onSelectEvent: (event: CalendarEvent) => void;
}

/**
 * Tagesansicht als Liste. Ein einzelner Tag hat zu wenige Termine, als dass
 * ein Zeitraster etwas hinzufügen würde – die Liste zeigt dafür mehr je Termin.
 */
export function DayView({ day, events, definitions, selectedEventId, onSelectEvent }: Props) {
  const { format, t, term } = useSettings();

  // Was schon vorher begonnen hat, kommt nach den Terminen des Tages.
  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) =>
          Number(Boolean(runningUntil(a, day, format))) - Number(Boolean(runningUntil(b, day, format))) ||
          a.start.localeCompare(b.start) ||
          a.title.localeCompare(b.title),
      ),
    [events, day, format],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Kein Datum hier: welcher Tag gemeint ist, steht in der Kopfzeile über
          dem Kalender. Bleibt die Zahl der Termine – die steht sonst nirgends. */}
      <div className="flex shrink-0 items-baseline px-6 py-2.5 hairline-b">
        <span className="text-[12px] text-faint">
          {sorted.length === 0
            ? t('eventCountZero')
            : sorted.length === 1
              ? t('eventCountOne')
              : t('eventCountMany', { count: sorted.length })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        {sorted.length === 0 ? (
          <p className="px-6 py-10 text-[13px] text-faint">{t('noEventsDay')}</p>
        ) : (
          <ul className="mx-auto flex w-full max-w-[760px] flex-col">
            {sorted.map((event) => {
              const definition = definitions.find((d) => d.id === event.sourceId);
              const selected = selectedEventId === event.id;
              const availability = displayAvailability(event);
              const until = runningUntil(event, day, format);
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    data-event-id={event.id}
                    onClick={() => onSelectEvent(event)}
                    aria-current={selected}
                    /* Derselbe Strich wie in den Spalten, in der Farbe der
                       Quelle – siehe `.row-hover` in `globals.css`. */
                    style={{ '--row-mark': sourceColor(definitions, event.sourceId) } as CSSProperties}
                    className={`row-hover flex w-full items-start gap-4 px-6 py-3.5 text-left hairline-b
                                ${selected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--chrome)]'}`}
                  >
                    <span className="w-[64px] shrink-0 truncate pt-[2px] text-[13px] tabular-nums text-text">
                      {until
                        ? t('until', { day: format.dayNumeric(until) })
                        : event.allDay
                          ? t('allDay')
                          : format.time(event.start)}
                    </span>
                    <span
                      aria-hidden="true"
                      className="mt-[6px] h-[16px] w-[2px] shrink-0 rounded-full"
                      style={{ background: sourceColor(definitions, event.sourceId) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span
                          className={`truncate text-[14px] font-medium ${
                            availability === 'available' || availability === 'limited'
                              ? 'text-text'
                              : 'text-muted'
                          }`}
                        >
                          {event.title}
                        </span>
                        {event.category && (
                          <span className="shrink-0 text-[11px] text-faint">{term(event.category)}</span>
                        )}
                      </span>
                      {event.subtitle && (
                        <span className="mt-0.5 block truncate text-[12px] text-muted">
                          {event.subtitle}
                        </span>
                      )}
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                        <span className="truncate">{event.venue.name}</span>
                        <span className="inline-flex items-center gap-1.5">
                          {/* Übersetzter Zustand; die Formulierung der Quelle steht im Titel. */}
                          <AvailabilityDot value={availability} />
                          <span title={availability === 'past' ? undefined : event.availabilityLabel}>
                            {t(availabilityKeys[availability])}
                          </span>
                        </span>
                      </span>
                    </span>
                    {definition && (
                      <span
                        className="hidden shrink-0 items-center gap-1.5 pt-[2px] text-[11px] text-faint sm:flex"
                        title={sourceName(definitions, event.sourceId)}
                      >
                        <SourceIcon source={definition} size={13} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
