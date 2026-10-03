'use client';

import { useEffect, useRef, useState } from 'react';
import type { CalendarEvent, EventPerformance, SourceDefinition } from '@/lib/events/types';
import {
  availabilityKeys,
  displayAvailability,
  isPast,
  sourceColor,
  sourceName,
} from '@/lib/events/display';
import { noteFacts } from '@/lib/events/notes';
import { useSettings } from '@/lib/settings/context';
import { DayAgenda } from './AgendaList';
import { SectionLabel } from './SectionLabel';
import { AvailabilityDot } from './AvailabilityDot';
import { CalendarPlus, ChevronLeft, Close, External, Ticket } from './icons';
import { ShareButton } from './ShareButton';

interface Props {
  day: string;
  dayEvents: CalendarEvent[];
  event?: CalendarEvent;
  shareUrl?: string;
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
  shareUrl,
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
          // Der Wochentag als runde Marke links – heute in der Akzentfarbe wie
          // im Kalender –, rechts daneben das Datum, gross und ohne Beiwerk.
          <h2 className="flex min-w-0 items-center gap-2.5" aria-label={format.dayLong(day)}>
            <span
              aria-hidden="true"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                day === format.today() ? 'bg-accent text-white' : 'bg-[var(--sunken)] text-text'
              }`}
            >
              {format.weekdayShort(day)}
            </span>
            <span aria-hidden="true" className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-[16px] font-semibold tracking-[-0.01em] text-text">
                {format.dayMonth(day)}
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-faint">{day.slice(0, 4)}</span>
            </span>
          </h2>
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
            shareUrl={shareUrl}
            definitions={definitions}
            onSelectPerformance={onSelectPerformance}
            revealPerformances={revealPerformances}
          />
        ) : (
          // Etwas Luft unter der Kopfzeile, bevor der erste Abschnitt beginnt.
          <div className="pt-3">
            <DayAgenda
              events={dayEvents}
              definitions={definitions}
              onSelect={onSelectEvent}
              emptyLabel={t('noEventsDay')}
              day={day}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function EventDetail({
  event,
  shareUrl,
  definitions,
  onSelectPerformance,
  revealPerformances,
}: {
  event: CalendarEvent;
  shareUrl?: string;
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
  // Preis und Dauer stehen in der Tabelle; was sonst in den Zusatzinfos steht, darunter.
  const facts = noteFacts(event);
  // Was schon gelaufen ist, ist kein weiterer Termin mehr.
  const upcoming = (event.relatedPerformances ?? []).filter((performance) => !isPast(performance));
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

      <div className="mt-2 flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-[19px] font-semibold leading-snug tracking-[-0.015em]">
          {event.title}
        </h3>
        {shareUrl && (
          <ShareButton
            url={shareUrl}
            title={event.title}
            label={t('shareEvent')}
            copiedLabel={t('menuLinkCopied')}
            iconOnly
            umamiEvent="share-event"
            umamiSource={event.sourceId}
            umamiCategory={event.category}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full
                       border border-line bg-[var(--canvas)] text-muted
                       hover:border-line-strong hover:text-text"
          />
        )}
      </div>
      {event.subtitle && <p className="mt-1 text-[13px] text-muted">{event.subtitle}</p>}

      {/* Linien nur zwischen den Zeilen: unter der letzten Zeile beginnt
          gleich der nächste Abschnitt mit seiner eigenen Linie. */}
      <dl className="mt-5 flex flex-col divide-y divide-[var(--line)]">
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
        {facts.prices.length > 0 && (
          <Row
            label={t('price')}
            value={facts.prices.map((price, i) => (
              <span key={i} className="block">
                {price}
              </span>
            ))}
          />
        )}
        {facts.duration && <Row label={t('duration')} value={facts.duration} />}
        {/* Weitere beschriftete Angaben der Quelle („Doors“, „Einlass“) –
            die Beschriftung bleibt in ihrem Wortlaut. */}
        {facts.attributes.map((attribute, i) => (
          <Row key={i} label={attribute.label} value={attribute.value} />
        ))}
      </dl>

      {/* Die Wege nach draussen gleich unter den Eckdaten – erst danach
          Zusatzinfos und weitere Termine. */}
      {availability === 'past' && (
        <p className="mt-4 rounded-[var(--radius-md)] bg-[var(--canvas)] px-3 py-2 text-[12px] text-muted">
          {t('pastNotice')}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {/* Nebeneinander: Programmseite und Karten sind die zwei Wege nach
            draussen. Fehlt der Kartenknopf, nimmt die Programmseite die Zeile. */}
        <div className="flex gap-2">
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            data-umami-event="event-page"
            data-umami-event-source={event.sourceId}
            data-umami-event-category={event.category}
            className="flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)]
                       border border-line bg-[var(--canvas)] px-2 text-[13px] text-text hover:border-line-strong"
          >
            <span className="truncate">{t('toEvent')}</span>
            <External className="h-3.5 w-3.5 shrink-0" />
          </a>
          {/* Kein Kartenknopf für Ausverkauftes und nichts, was schon gelaufen ist. */}
          {event.ticketUrl && availability !== 'soldout' && availability !== 'past' && (
            <a
              href={event.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={t('ticketsAtOrganizer')}
              data-umami-event="tickets"
              data-umami-event-source={event.sourceId}
              data-umami-event-category={event.category}
              className="flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)]
                         bg-accent px-2 text-[13px] font-medium text-white hover:opacity-90"
            >
              <Ticket className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('tickets')}</span>
              <External className="h-3.5 w-3.5 shrink-0 opacity-70" />
            </a>
          )}
        </div>
        {/* Jeder Termin lässt sich übernehmen: bietet die Quelle keine .ics an,
            erzeugt der eigene Server sie aus dem Datenmodell. */}
        <a
          href={`/api/events/${encodeURIComponent(event.id)}/ics`}
          download
          data-umami-event="ics-download"
          data-umami-event-source={event.sourceId}
          data-umami-event-category={event.category}
          className="flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-[13px]
                     text-muted hover:text-text"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          {t('addToCalendar')}
        </a>
      </div>

      {facts.rest.length > 0 && (
        <div className="mt-4 flex flex-col gap-1 border-t border-line pt-3">
          {facts.rest.map((note, i) => (
            <p key={i} className="text-[12px] leading-relaxed text-muted">
              {note}
            </p>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <section ref={performances} className="mt-4">
          {/* Neu pro Termin: wer zum nächsten wechselt, sieht wieder die ersten drei. */}
          <OtherPerformances
            key={event.id}
            performances={upcoming}
            onSelectPerformance={onSelectPerformance}
          />
        </section>
      )}

      {/* Der Programmtext steht zuletzt: erst die Eckdaten und die Wege zur
          Karte, dann der lange Text, der sonst alles darunter wegdrückt. */}
      {event.description && (
        <section className="mt-4">
          <SectionLabel>{t('program')}</SectionLabel>
          <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-muted">
            {event.description}
          </p>
        </section>
      )}
    </article>
  );
}

/** So viele weitere Termine stehen da, bevor der Rest eingeklappt bleibt. */
const PERFORMANCE_PREVIEW = 3;

/** Weitere Termine derselben Produktion – die ersten drei, der Rest auf Wunsch. */
function OtherPerformances({
  performances,
  onSelectPerformance,
}: {
  performances: EventPerformance[];
  onSelectPerformance: (performance: EventPerformance) => void;
}) {
  const { t } = useSettings();
  const [showAll, setShowAll] = useState(false);
  const hidden = performances.length - PERFORMANCE_PREVIEW;
  const shown = showAll ? performances : performances.slice(0, PERFORMANCE_PREVIEW);

  return (
    <>
      <SectionLabel>{t('otherPerformances')}</SectionLabel>
      <div className="mt-1 flex flex-col gap-1.5">
        {shown.map((performance) => (
          <PerformanceButton
            key={performance.id}
            performance={performance}
            onSelect={() => onSelectPerformance(performance)}
          />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((all) => !all)}
          aria-expanded={showAll}
          className="mt-1.5 w-full rounded-[var(--radius-sm)] py-1.5 text-[12px] text-muted hover:text-text"
        >
          {showAll ? t('collapse') : t('more', { count: hidden })}
        </button>
      )}
    </>
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
      className="row-hover flex w-full items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--canvas)]
                 px-2.5 py-2 text-left text-[12px] hover:bg-[var(--accent-soft)]"
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
    <div className="flex gap-3 py-1.5">
      {/* Beschriftungen der Quelle können länger sein („Altersempfehlung“). */}
      <dt className="w-[84px] shrink-0 hyphens-auto break-words text-[12px] text-faint">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-text">{value}</dd>
    </div>
  );
}
