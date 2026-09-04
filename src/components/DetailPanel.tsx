'use client';

import { useEffect, useRef } from 'react';
import type { CalendarEvent, EventPerformance, SourceDefinition } from '@/lib/events/types';
import { availabilityKeys, displayAvailability, sourceColor, sourceName } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { AgendaList } from './AgendaList';
import { AvailabilityDot } from './AvailabilityDot';
import { CalendarPlus, ChevronLeft, Close, External, Ticket } from './icons';

interface Props {
  day: string;
  dayEvents: CalendarEvent[];
  event?: CalendarEvent;
  definitions: SourceDefinition[];
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectPerformance: (performance: EventPerformance) => void;
  onBackToDay: () => void;
  onClose?: () => void;
  /**
   * Zähler statt Schalter: jede Erhöhung rollt die weiteren Termine ins Bild.
   * Nur so lässt sich derselbe Wunsch zweimal hintereinander äussern.
   */
  revealPerformances?: number;
}

/**
 * Rechte Spalte: ohne Auswahl der Tag, mit Auswahl das einzelne Event.
 * Auf kleinen Bildschirmen wird dieselbe Komponente als Sheet eingeblendet.
 */
export function DetailPanel({
  day,
  dayEvents,
  event,
  definitions,
  onSelectEvent,
  onSelectPerformance,
  onBackToDay,
  onClose,
  revealPerformances = 0,
}: Props) {
  const { format, t } = useSettings();

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--chrome)]">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4 hairline-b">
        {event ? (
          <button
            type="button"
            onClick={onBackToDay}
            className="-ml-1.5 flex min-w-0 items-center gap-1 rounded-[var(--radius-sm)] py-1 pl-1 pr-2
                       text-[12px] text-muted hover:text-text"
          >
            <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{format.dayNoWeekday(day)}</span>
          </button>
        ) : (
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold">{format.weekdayLong(day)}</h2>
            <p className="truncate text-[12px] text-muted">
              {format.dayNoWeekday(day)} · {countLabel(dayEvents.length, t)}
            </p>
          </div>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="ml-auto grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-muted hover:text-text"
          >
            <Close />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        {event ? (
          <EventDetail
            event={event}
            definitions={definitions}
            onSelectPerformance={onSelectPerformance}
            revealPerformances={revealPerformances}
          />
        ) : (
          <AgendaList
            events={dayEvents}
            definitions={definitions}
            onSelect={onSelectEvent}
            emptyLabel={t('noEventsDay')}
          />
        )}
      </div>
    </div>
  );
}

function EventDetail({
  event,
  definitions,
  onSelectPerformance,
  revealPerformances,
}: {
  event: CalendarEvent;
  definitions: SourceDefinition[];
  onSelectPerformance: (performance: EventPerformance) => void;
  revealPerformances: number;
}) {
  const { format, t, term } = useSettings();
  const color = sourceColor(definitions, event.sourceId);
  const day = event.start.slice(0, 10);
  // Ein Termin, der über den Starttag hinausreicht: der letzte Tag des Laufs.
  const endDay = event.end?.slice(0, 10);
  const runsUntil = endDay && endDay > day ? endDay : undefined;
  const availability = displayAvailability(event);
  const performances = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!revealPerformances) return;
    performances.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [revealPerformances, event.id]);

  return (
    <article className="px-4 py-4">
      <div className="flex items-center gap-1.5">
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: color }} />
        <span className="text-[12px] text-muted">{sourceName(definitions, event.sourceId)}</span>
        {event.category && (
          <>
            <span className="text-faint">·</span>
            <span className="text-[12px] text-muted" title={event.categoryLabel}>
              {term(event.category)}
            </span>
          </>
        )}
      </div>

      <h3 className="mt-2 text-[19px] font-semibold leading-snug tracking-[-0.015em]">{event.title}</h3>
      {event.subtitle && <p className="mt-1 text-[13px] text-muted">{event.subtitle}</p>}

      <dl className="mt-5 flex flex-col">
        <Row label={t('date')} value={format.dayNoWeekday(day)} />
        <Row label={t('weekday')} value={format.weekdayLong(day)} />
        <Row label={t('time')} value={event.allDay ? t('allDay') : format.time(event.start)} />
        {/* Läufe (Ausstellungen, Installationen) tragen keine Uhrzeit, aber ein
            Ende – ohne diese Zeile wäre nicht zu sehen, warum. */}
        {runsUntil && <Row label={t('runsUntil')} value={format.dayNoWeekday(runsUntil)} />}
        <Row label={t('venue')} value={[event.venue.name, event.venue.city].filter(Boolean).join(', ')} />
        <Row
          label={t('tickets')}
          value={
            <span className="inline-flex items-center gap-1.5">
              <AvailabilityDot value={availability} />
              {/* Übersetzter Zustand; die Originalformulierung der Quelle steht im Titel. */}
              <span title={availability === 'past' ? undefined : event.availabilityLabel}>
                {t(availabilityKeys[availability])}
              </span>
            </span>
          }
        />
      </dl>

      {event.notes && event.notes.length > 0 && (
        <div className="mt-4 flex flex-col gap-1 border-t border-line pt-3">
          {event.notes.map((note, i) => (
            <p key={i} className="text-[12px] leading-relaxed text-muted">
              {note}
            </p>
          ))}
        </div>
      )}

      {event.relatedPerformances && event.relatedPerformances.length > 0 && (
        <section ref={performances} className="mt-5 border-t border-line pt-3">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
            {t('otherPerformances')}
          </h4>
          <div className="mt-2 flex flex-col gap-1.5">
            {event.relatedPerformances.map((performance) => (
              <PerformanceButton
                key={performance.id}
                performance={performance}
                onSelect={() => onSelectPerformance(performance)}
              />
            ))}
          </div>
        </section>
      )}

      {availability === 'past' && (
        <p className="mt-4 rounded-[var(--radius-md)] bg-[var(--canvas)] px-3 py-2 text-[12px] text-muted">
          {t('pastNotice')}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {/* Kein Kartenknopf für Ausverkauftes und nichts, was schon gelaufen ist. */}
        {event.ticketUrl && availability !== 'soldout' && availability !== 'past' && (
          <a
            href={event.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-accent
                       text-[13px] font-medium text-white hover:opacity-90"
          >
            <Ticket className="h-4 w-4" />
            {t('ticketsAtOrganizer')}
            <External className="h-3.5 w-3.5 opacity-70" />
          </a>
        )}
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-line
                     bg-[var(--canvas)] text-[13px] text-text hover:border-line-strong"
        >
          {t('toEvent')}
          <External className="h-3.5 w-3.5" />
        </a>
        {/* Jeder Termin lässt sich übernehmen: bietet die Quelle keine .ics an,
            erzeugt der eigene Server sie aus dem Datenmodell. */}
        <a
          href={`/api/events/${encodeURIComponent(event.id)}/ics`}
          download
          className="flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-[13px]
                     text-muted hover:text-text"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          {t('addToCalendar')}
        </a>
      </div>

      {/* Der Programmtext steht zuletzt: erst die Eckdaten und die Wege zur
          Karte, dann der lange Text, der sonst alles darunter wegdrückt. */}
      {event.description && (
        <section className="mt-5 border-t border-line pt-3">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
            {t('program')}
          </h4>
          <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-muted">
            {event.description}
          </p>
        </section>
      )}
    </article>
  );
}

function PerformanceButton({
  performance,
  onSelect,
}: {
  performance: EventPerformance;
  onSelect: () => void;
}) {
  const { format, t } = useSettings();
  const day = performance.start.slice(0, 10);
  const availability = displayAvailability(performance);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--canvas)] px-2.5 py-2 text-left
                 text-[12px] hover:bg-[var(--accent-soft)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text">
          {format.dayNoWeekday(day)}
          {!performance.allDay && ` · ${format.time(performance.start)}`}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-muted">
          <AvailabilityDot value={availability} />
          <span className="truncate">{t(availabilityKeys[availability])}</span>
        </span>
      </span>
    </button>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 hairline-b">
      <dt className="w-[84px] shrink-0 text-[12px] text-faint">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-text">{value}</dd>
    </div>
  );
}

function countLabel(count: number, t: ReturnType<typeof useSettings>['t']): string {
  if (count === 0) return t('eventCountZero');
  if (count === 1) return t('eventCountOne');
  return t('eventCountMany', { count });
}
