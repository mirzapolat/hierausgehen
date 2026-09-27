'use client';

import { useMemo, type CSSProperties } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { addDays, daysBetween, startOfWeek, type ViewMode } from '@/lib/calendar';
import { byDay, isPast, sourceColor } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { DayView } from './DayView';
import { MobileAgenda } from './MobileAgenda';
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
  /** Ob es in diese Richtung überhaupt noch einen Zeitraum gibt. */
  canStep: (direction: -1 | 1) => boolean;
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
  canStep,
}: Props) {
  const { t } = useSettings();
  const step = mode === 'day' ? 1 : 7;

  return (
    <SwipePager
      anchor={anchor}
      pageAnchor={(offset) => addDays(anchor, offset * step)}
      onStep={onStep}
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
          />
        )
      }
    </SwipePager>
  );
}

/** Ein Tag des Streifens – filtert die Termine in der Zeitzone der Anzeige. */
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
  const dayEvents = useMemo(
    () => events.filter((event) => format.localDay(event.start) === day),
    [events, format, day],
  );

  return (
    <DayView
      events={dayEvents}
      definitions={definitions}
      selectedEventId={selectedEventId}
      onSelectEvent={onSelectEvent}
    />
  );
}

function WeekLists({
  anchor,
  events,
  definitions,
  selectedEventId,
  onSelectEvent,
}: Omit<Props, 'mode' | 'onStep' | 'canStep'>) {
  const { format, t } = useSettings();
  const from = startOfWeek(anchor);
  const to = addDays(from, 6);
  const desktopDays = useMemo(() => daysBetween(from, to), [from, to]);
  const grouped = useMemo(() => byDay(events, format), [events, format]);
  const today = format.today();

  return (
    <div className="h-full min-h-0">
      {/* Desktop: eine Bildlaufleiste für die ganze Woche, die Tagesköpfe bleiben oben stehen. */}
      <div className="hidden h-full min-h-0 overflow-y-auto scroll-quiet lg:block">
        <div className="grid min-h-full grid-cols-7">
          {desktopDays.map((day) => {
            const dayEvents = grouped.get(day) ?? [];
            const isToday = day === today;
            return (
              // Kein eingefärbter Tag mehr: die Spalte zeigt ihre Termine
              // selbst, und die Detailspalte hängt hier nicht mehr an der
              // Auswahl. Heute bleibt am blauen Punkt in der Kopfzeile kenntlich.
              <section key={day} className="flex min-w-0 flex-col hairline-r">
                {/* Nur eine Beschriftung, kein Knopf: einen Tag auszuwählen
                    bewirkt in dieser Ansicht nichts mehr, seit die Spalte
                    daneben nur noch einzelne Termine zeigt. */}
                {/* Leicht abgesetzt – Chrome-Ton und kräftigere Linie –, damit
                    die Köpfe über den durchlaufenden Listen stehen bleiben. */}
                <div
                  className="sticky top-0 z-10 flex items-center gap-1 border-b border-line-strong
                             bg-[var(--chrome)] px-1.5 py-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium uppercase tracking-[0.05em] text-muted">
                      {format.weekdayShort(day)}
                    </span>
                    <span className="block truncate text-[10px] text-muted">
                      {format.monthName(day)}
                    </span>
                  </span>
                  <span
                    className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[13px] tabular-nums ${
                      isToday ? 'bg-accent font-semibold text-white' : 'text-text'
                    }`}
                  >
                    {format.dayNumber(day)}
                  </span>
                </div>
                <WeekDayList
                  events={dayEvents}
                  definitions={definitions}
                  selectedEventId={selectedEventId}
                  onSelectEvent={onSelectEvent}
                  emptyLabel={t('noEventsDay')}
                />
              </section>
            );
          })}
        </div>
      </div>

      <div className="h-full overflow-y-auto scroll-quiet lg:hidden">
        <MobileAgenda
          from={from}
          to={to}
          events={events}
          definitions={definitions}
          selectedEventId={selectedEventId}
          onSelectEvent={onSelectEvent}
          hideEmptyDays={false}
        />
      </div>
    </div>
  );
}

function WeekDayList({
  events,
  definitions,
  selectedEventId,
  onSelectEvent,
  emptyLabel,
}: {
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedEventId?: string;
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
              style={{ '--row-mark': sourceColor(definitions, event.sourceId) } as CSSProperties}
              className={`row-hover block w-full min-w-0 overflow-hidden px-2 py-2 text-left ${
                selected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--chrome)]'
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background: sourceColor(definitions, event.sourceId),
                    opacity: past ? 0.35 : 1,
                  }}
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
