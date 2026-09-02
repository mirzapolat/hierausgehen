'use client';

import { useMemo } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { addDays, daysBetween, startOfWeek, type ViewMode } from '@/lib/calendar';
import { byDay, sourceColor } from '@/lib/events/display';
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
      className="flex h-full min-h-0 min-w-0 flex-1"
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
      day={day}
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
  selectedDay,
  selectedEventId,
  onSelectDay,
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
            const selected = day === selectedDay;
            return (
              <section
                key={day}
                className={`flex min-w-0 flex-col hairline-r ${
                  selected ? 'bg-[var(--accent-soft)]/35' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className="sticky top-0 z-10 flex items-center gap-1 px-1.5 py-2 text-left hairline-b
                             hover:bg-[var(--chrome)]"
                  style={{ background: selected ? 'var(--accent-soft)' : 'var(--canvas)' }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] uppercase tracking-[0.05em] text-faint">
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
                </button>
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
  const { format } = useSettings();

  if (events.length === 0) {
    return <p className="px-2 py-4 text-[11px] leading-snug text-faint">{emptyLabel}</p>;
  }

  return (
    <ul className="min-w-0">
      {events.map((event) => {
        const selected = selectedEventId === event.id;
        return (
          <li key={event.id} className="min-w-0 hairline-b">
            <button
              type="button"
              data-event-id={event.id}
              onClick={() => onSelectEvent(event)}
              aria-current={selected}
              className={`block w-full min-w-0 overflow-hidden px-2 py-2 text-left transition-colors ${
                selected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--chrome)]'
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: sourceColor(definitions, event.sourceId) }}
                />
                <span className="truncate text-[11px] tabular-nums text-muted">
                  {event.allDay ? '—' : format.time(event.start)}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[12px] font-medium text-text">
                {event.title}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-faint">{event.venue.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
