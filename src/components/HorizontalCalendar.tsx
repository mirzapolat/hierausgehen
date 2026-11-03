'use client';

import { useMemo, type CSSProperties } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { addDays, daysBetween, layoutSpans, startOfWeek, type ViewMode } from '@/lib/calendar';
import { byDay, eventsOnDay, isPast, sourceColor, splitSpans } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { DayView } from './DayView';
import { MobileAgenda } from './MobileAgenda';
import { SpanBars } from './SpanBars';
import { SwipePager } from './SwipePager';

interface Props {
  mode: Exclude<ViewMode, 'month'>;
  anchor: string;
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedDay: string;
  selectedEventId?: string;
  onSelectDay: (day: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onStep: (direction: -1 | 1) => void;
  /** Wohin ein laufendes Wischen führt (siehe `SwipePager`). */
  onPreview?: (direction: -1 | 0 | 1) => void;
  /** Ob es in diese Richtung überhaupt noch einen Zeitraum gibt. */
  canStep: (direction: -1 | 1) => boolean;
  /** Weitere Termine derselben Produktion wie der gewählte. */
  relatedIds?: ReadonlySet<string>;
}

/**
 * Tages- und Wochenansicht als wischbarer Streifen.
 *
 * Das Blättern selbst steckt in `SwipePager`; hier steht nur, was auf einer
 * Seite zu sehen ist.
 */
export function HorizontalCalendar({
  mode,
  anchor,
  events,
  definitions,
  selectedDay,
  selectedEventId,
  onSelectDay,
  onSelectEvent,
  onStep,
  onPreview,
  canStep,
  relatedIds,
}: Props) {
  const { t } = useSettings();
  const step = mode === 'day' ? 1 : 7;

  return (
    <SwipePager
      anchor={anchor}
      pageAnchor={(offset) => addDays(anchor, offset * step)}
      onStep={onStep}
      onPreview={onPreview}
      canStep={canStep}
      resetKey={mode}
      label={mode === 'day' ? t('day') : t('week')}
      className="flex h-full min-h-0 min-w-0 flex-1 scroll-quiet"
    >
      {(pageAnchor) =>
        mode === 'day' ? (
          <DayPage
            day={pageAnchor}
            events={events}
            definitions={definitions}
            selectedEventId={selectedEventId}
            onSelectEvent={onSelectEvent}
          />
        ) : (
          <WeekLists
            anchor={pageAnchor}
            events={events}
            definitions={definitions}
            selectedDay={selectedDay}
            selectedEventId={selectedEventId}
            onSelectDay={onSelectDay}
            onSelectEvent={onSelectEvent}
            relatedIds={relatedIds}
          />
        )
      }
    </SwipePager>
  );
}

/**
 * Ein Tag des Streifens – filtert die Termine in der Zeitzone der Anzeige.
 * Mehrtägiges, das schon vorher begonnen hat, steht hinter den Terminen des Tages.
 */
function DayPage({
  day,
  events,
  definitions,
  selectedEventId,
  onSelectEvent,
}: {
  day: string;
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedEventId?: string;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const { format } = useSettings();
  const dayEvents = useMemo(() => eventsOnDay(events, day, format), [events, format, day]);

  return (
    <DayView
      day={day}
      events={dayEvents}
      definitions={definitions}
      selectedEventId={selectedEventId}
      onSelectEvent={onSelectEvent}
    />
  );
}

/** Spurhöhe der Balken über den Wochenspalten. */
const WEEK_LANE = 22;

function WeekLists({
  anchor,
  events,
  definitions,
  selectedEventId,
  onSelectEvent,
  relatedIds,
}: Omit<Props, 'mode' | 'onStep' | 'onPreview' | 'canStep'>) {
  const { format, t } = useSettings();
  const from = startOfWeek(anchor);
  const to = addDays(from, 6);
  const desktopDays = useMemo(() => daysBetween(from, to), [from, to]);
  const { single, spans } = useMemo(() => splitSpans(events, format), [events, format]);
  const grouped = useMemo(() => byDay(single, format), [single, format]);
  // Die Woche hat Platz: hier bekommt jeder mehrtägige Termin seinen Balken.
  const { segments } = useMemo(() => layoutSpans(spans, desktopDays), [spans, desktopDays]);
  const today = format.today();

  return (
    <div className="h-full min-h-0">
      {/* Desktop und quer gehaltenes Telefon: eine Bildlaufleiste für die
          ganze Woche, die Tagesköpfe bleiben oben stehen. */}
      <div className="hidden h-full min-h-0 flex-col overflow-y-auto scroll-quiet pb-safe landscape:flex lg:flex">
        {/* Leicht abgesetzt – Chrome-Ton und kräftigere Linie –, damit die
            Köpfe über den durchlaufenden Listen stehen bleiben. Nur
            Beschriftungen, keine Knöpfe: einen Tag auszuwählen bewirkt in
            dieser Ansicht nichts. Heute bleibt am blauen Punkt kenntlich. */}
        <div className="sticky top-0 z-10 grid shrink-0 grid-cols-7 border-b border-line-strong bg-[var(--chrome)]">
          {desktopDays.map((day) => (
            <div
              key={day}
              className="flex min-w-0 items-center gap-1 px-1.5 py-2 text-left hairline-r last:border-r-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium uppercase tracking-[0.05em] text-muted">
                  {format.weekdayShort(day)}
                </span>
                <span className="block truncate text-[10px] text-muted">{format.monthName(day)}</span>
              </span>
              <span
                className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[13px] tabular-nums ${
                  day === today ? 'bg-accent font-semibold text-white' : 'text-text'
                }`}
              >
                {format.dayNumber(day)}
              </span>
            </div>
          ))}
        </div>

        {/* Mehrtägiges als Balken über den Spalten – wie im Monatsraster. */}
        {segments.length > 0 && (
          <div className="relative shrink-0 py-1 hairline-b">
            <div aria-hidden="true" className="absolute inset-0 grid grid-cols-7">
              {desktopDays.map((day) => (
                <div key={day} className="hairline-r last:border-r-0" />
              ))}
            </div>
            <div className="relative">
              <SpanBars
                segments={segments}
                definitions={definitions}
                selectedEventId={selectedEventId}
                relatedIds={relatedIds}
                onSelectEvent={onSelectEvent}
                laneHeight={WEEK_LANE}
              />
            </div>
          </div>
        )}

        <div className="grid flex-1 grid-cols-7">
          {desktopDays.map((day) => (
            <section key={day} className="flex min-w-0 flex-col hairline-r last:border-r-0">
              <WeekDayList
                events={grouped.get(day) ?? []}
                definitions={definitions}
                selectedEventId={selectedEventId}
                relatedIds={relatedIds}
                onSelectEvent={onSelectEvent}
                emptyLabel={t('noEventsDay')}
              />
            </section>
          ))}
        </div>
      </div>

      <div className="h-full overflow-y-auto scroll-quiet pb-safe landscape:hidden lg:hidden">
        <MobileAgenda
          from={from}
          to={to}
          events={events}
          definitions={definitions}
          selectedEventId={selectedEventId}
          onSelectEvent={onSelectEvent}
          hideEmptyDays={false}
          relatedIds={relatedIds}
        />
      </div>
    </div>
  );
}

function WeekDayList({
  events,
  definitions,
  selectedEventId,
  relatedIds,
  onSelectEvent,
  emptyLabel,
}: {
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedEventId?: string;
  relatedIds?: ReadonlySet<string>;
  onSelectEvent: (event: CalendarEvent) => void;
  emptyLabel: string;
}) {
  const { format, t } = useSettings();

  if (events.length === 0) {
    return <p className="px-2 py-4 text-[11px] leading-snug text-faint">{emptyLabel}</p>;
  }

  return (
    <ul className="min-w-0">
      {events.map((event) => {
        const selected = selectedEventId === event.id;
        // Weitere Termine derselben Produktion: in der Farbe der Quelle
        // unterlegt, solange der gewählte Termin offen ist.
        const related = !selected && relatedIds?.has(event.id);
        const color = sourceColor(definitions, event.sourceId);
        // Was vorbei ist, tritt zurück – es verschwindet aber nicht, sonst
        // sähe ein halb gelaufener Tag leerer aus, als er war. Dieselbe
        // Abstufung wie im Monatsraster (`MonthDayCell`).
        const past = isPast(event);
        return (
          <li key={event.id} className="min-w-0 hairline-b">
            <button
              type="button"
              data-event-id={event.id}
              onClick={() => onSelectEvent(event)}
              aria-current={selected}
              /* Der Strich am linken Rand trägt die Farbe der Quelle – dieselbe
                 Bewegung wie in beiden Spalten (`.row-hover` in `globals.css`). */
              style={
                {
                  '--row-mark': color,
                  ...(related ? { background: `color-mix(in srgb, ${color} 14%, var(--canvas))` } : {}),
                } as CSSProperties
              }
              className={`row-hover block w-full min-w-0 overflow-hidden px-2 py-2 text-left ${
                selected ? 'bg-[var(--accent-soft)]' : related ? '' : 'hover:bg-[var(--chrome)]'
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: color, opacity: past ? 0.35 : 1 }}
                />
                <span
                  className={`truncate text-[11px] tabular-nums ${past ? 'text-faint' : 'text-muted'}`}
                >
                  {event.allDay ? t('allDay') : format.time(event.start)}
                </span>
              </span>
              <span
                className={`mt-0.5 block truncate text-[12px] font-medium ${
                  past ? 'text-faint' : 'text-text'
                }`}
              >
                {event.title}
              </span>
              <span
                className={`mt-0.5 block truncate text-[10px] text-faint ${past ? 'opacity-70' : ''}`}
              >
                {event.venue.name}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
