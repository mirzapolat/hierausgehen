'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { addDays, daysBetween, startOfWeek, type ViewMode } from '@/lib/calendar';
import { byDay, sourceColor } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { DayView } from './DayView';
import { MobileAgenda } from './MobileAgenda';

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
 * Horizontaler, endlos wirkender Tages-/Wochenstreifen.
 *
 * Es stehen immer Seiten vor und nach dem aktuellen Zeitraum bereit.
 * Nach einem Wischen wird der Anker verschoben und der Streifen unsichtbar auf
 * die mittlere Seite zurückgesetzt. So bleibt der DOM klein, egal wie weit man
 * blättert.
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
  const { format, t } = useSettings();
  const scroller = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const navigating = useRef(false);
  const [pageSpan, setPageSpan] = useState(0);

  // Am Rand des erhobenen Zeitraums entfällt die Seite – dann lässt sich dort
  // auch nicht hinwischen.
  const back = canStep(-1);
  const offsets = [...(back ? [-1] : []), 0, ...(canStep(1) ? [1] : [])];
  const centerPage = back ? 1 : 0;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setPageSpan(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Der aktuelle Zeitraum liegt stets auf der mittleren Seite.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || pageSpan === 0) return;
    element.scrollLeft = pageSpan * centerPage;
    navigating.current = false;
  }, [anchor, centerPage, mode, pageSpan]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const onScroll = () => {
    const element = scroller.current;
    if (!element || pageSpan === 0 || navigating.current) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const page = Math.round(element.scrollLeft / pageSpan);
      if (page === centerPage) return;
      navigating.current = true;
      onStep(page < centerPage ? -1 : 1);
    }, 90);
  };

  const step = mode === 'day' ? 1 : 7;
  const pages = offsets.map((offset) => addDays(anchor, offset * step));

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      aria-label={mode === 'day' ? t('day') : t('week')}
      className="flex h-full min-h-0 min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-quiet"
    >
      {pages.map((pageAnchor) => (
        <div key={pageAnchor} className="h-full w-full max-w-full flex-none snap-start snap-always overflow-hidden">
          {mode === 'day' ? (
            <DayView
              day={pageAnchor}
              events={events.filter((event) => format.localDay(event.start) === pageAnchor)}
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
          )}
        </div>
      ))}
    </div>
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
