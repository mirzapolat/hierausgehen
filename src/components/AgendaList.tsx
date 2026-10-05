'use client';

import { useState, type CSSProperties } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import {
  displayAvailability,
  eventSpan,
  runningUntil,
  sourceColor,
  splitExhibitions,
} from '@/lib/events/display';
import { useSavedEvents } from '@/lib/saved';
import { useSettings } from '@/lib/settings/context';
import { AvailabilityDot } from './AvailabilityDot';
import { SectionLabel } from './SectionLabel';
import { Bookmark } from './icons';

interface Props {
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedId?: string;
  onSelect: (event: CalendarEvent) => void;
  emptyLabel?: string;
  /**
   * Der Tag, den die Liste zeigt. Mehrtägiges, das schon vorher begonnen hat,
   * trägt dann „bis …" statt einer Uhrzeit, die an diesem Tag nicht gilt.
   */
  day?: string;
  /** Mehrtägiges immer mit „bis …" beschriften – für Listen ohne einzelnen Tag. */
  spanLabels?: boolean;
  /** Weitere Termine derselben Produktion wie der gewählte. */
  relatedIds?: ReadonlySet<string>;
}

/**
 * Die Tagesvorschau: Veranstaltungen und Ausstellungen in zwei Abschnitten.
 *
 * Ohne Ausstellungen bleibt es bei der schlichten Liste ohne Überschrift –
 * die Trennung soll ordnen, nicht jeden Tag verlängern. Gibt es nur
 * Ausstellungen, steht ihre Überschrift trotzdem da, damit klar ist, was
 * die Liste zeigt. Welcher Teil zuerst kommt, steht in den Einstellungen;
 * jeder lässt sich über seine Marke einklappen.
 */
export function DayAgenda(props: Props) {
  const { t, settings } = useSettings();
  // Eingeklappt bleibt eingeklappt, auch wenn ein anderer Tag gewählt wird.
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionKey>>(new Set());
  const { events, exhibitions } = splitExhibitions(props.events);

  if (exhibitions.length === 0) return <AgendaList {...props} />;

  const sections: { key: SectionKey; label: string; events: CalendarEvent[] }[] = [
    { key: 'exhibitions' as const, label: t('sectionExhibitions'), events: exhibitions },
    { key: 'events' as const, label: t('sectionEvents'), events },
  ].filter((section) => section.events.length > 0);
  if (settings.dayOrder === 'events') sections.reverse();

  const toggle = (key: SectionKey) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col">
      {sections.map((section, index) => {
        const open = !collapsed.has(section.key);
        return (
          <section key={section.key} className={index > 0 ? 'mt-3' : undefined}>
            <SectionLabel expanded={open} onToggle={() => toggle(section.key)} count={section.events.length}>
              {section.label}
            </SectionLabel>
            {open && <AgendaList {...props} events={section.events} />}
          </section>
        );
      })}
    </div>
  );
}

type SectionKey = 'events' | 'exhibitions';

/**
 * Terminliste eines Tages. Wird in der Detailspalte und mobil verwendet –
 * eine Darstellung, ein Verhalten.
 */
export function AgendaList({
  events,
  definitions,
  selectedId,
  onSelect,
  emptyLabel,
  day,
  spanLabels = false,
  relatedIds,
}: Props) {
  const { cityId, format, t } = useSettings();
  const saved = useSavedEvents(cityId);

  if (events.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-faint">{emptyLabel ?? t('noEvents')}</p>;
  }

  const timeLabel = (event: CalendarEvent) => {
    const until = spanLabels ? eventSpan(event, format)?.to : day && runningUntil(event, day, format);
    if (until) return t('until', { day: format.dayNumeric(until) });
    return event.allDay ? t('allDay') : format.time(event.start);
  };

  return (
    // Linien nur zwischen den Terminen – nach dem letzten folgt Weissraum
    // oder der nächste Abschnitt, keine zweite Linie.
    <ul className="flex flex-col divide-y divide-[var(--line)]">
      {events.map((event) => {
        const color = sourceColor(definitions, event.sourceId);
        const selected = selectedId === event.id;
        const related = !selected && relatedIds?.has(event.id);
        return (
          <li key={event.id}>
            <button
              type="button"
              data-event-id={event.id}
              onClick={() => onSelect(event)}
              aria-current={selected}
              /* Der Strich beim Überfahren trägt die Farbe der Quelle – dieselbe
                 wie der Balken zwei Spalten weiter (siehe `.row-hover`). */
              style={
                {
                  '--row-mark': color,
                  ...(related ? { background: `color-mix(in srgb, ${color} 12%, var(--canvas))` } : {}),
                } as CSSProperties
              }
              className={`row-hover flex w-full items-start gap-3 px-4 py-2.5 text-left
                          ${selected ? 'bg-[var(--accent-soft)]' : related ? '' : 'hover:bg-[var(--chrome)]'}`}
            >
              {/* Etwas breiter als für „19:30" nötig: in dieselbe Spalte muss
                  auch „Ganztägig" passen, ohne abgeschnitten zu werden. */}
              <span className="w-[64px] shrink-0 pt-[1px] text-[12px] tabular-nums text-muted">
                {timeLabel(event)}
              </span>
              <span
                aria-hidden="true"
                className="mt-[5px] h-[13px] w-[2px] shrink-0 rounded-full"
                style={{ background: color }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-text">{event.title}</span>
                  {saved.isSaved(event) && (
                    <span title={t('onlySaved')} className="shrink-0 text-accent">
                      <Bookmark filled className="h-3 w-3" />
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                  <AvailabilityDot value={displayAvailability(event)} />
                  <span className="truncate">{event.venue.name}</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
