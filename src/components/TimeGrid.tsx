'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { byDay, eventMinutes, isPast, sourceColor } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';

interface Props {
  days: string[];
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedDay: string;
  selectedEventId?: string;
  onSelectDay: (day: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Unterhalb dieser Zeilenhöhe wird gescrollt statt weiter gestaucht. */
const MIN_PX_PER_HOUR = 30;
const GUTTER = 56;

/**
 * Zeitraster für Wochen- und Tagesansicht. Der volle Tag wird auf die
 * verfügbare Höhe verteilt; erst wenn die Zeilen zu flach würden, entsteht ein
 * Scrollbereich. Beim Öffnen wird auf den ersten Termin gescrollt.
 */
export function TimeGrid({
  days,
  events,
  definitions,
  selectedDay,
  selectedEventId,
  onSelectDay,
  onSelectEvent,
}: Props) {
  const { format, t } = useSettings();
  const grouped = useMemo(() => byDay(events, format), [events, format]);
  const currentDay = format.today();

  const scroller = useRef<HTMLDivElement>(null);
  const [pxPerHour, setPxPerHour] = useState(MIN_PX_PER_HOUR);

  // Höhe messen und das Raster darauf verteilen.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const apply = () => setPxPerHour(Math.max(MIN_PX_PER_HOUR, element.clientHeight / HOURS.length));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Wenn gescrollt werden muss, den ersten Termin des Zeitraums zeigen.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const starts = days
      .flatMap((day) => grouped.get(day) ?? [])
      .map((event) => eventMinutes(event, format).start);
    const earliest = starts.length ? Math.min(...starts) : 18 * 60;
    const target = Math.max(0, (earliest / 60) * pxPerHour - pxPerHour);
    element.scrollTo({ top: Math.min(target, element.scrollHeight - element.clientHeight) });
  }, [days, grouped, pxPerHour, format]);

  const nowOffset = useNowOffset(pxPerHour, format);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 hairline-b" style={{ paddingLeft: GUTTER }}>
        {days.map((day) => {
          const isToday = day === currentDay;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(day)}
              aria-label={format.dayLong(day)}
              className={`flex flex-1 items-baseline justify-center gap-1.5 py-2 hairline-l transition-colors
                          ${day === selectedDay ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--chrome)]'}`}
            >
              <span className="text-[11px] uppercase tracking-[0.05em] text-faint">
                {format.weekdayShort(day)}
              </span>
              <span
                className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[13px] tabular-nums
                            ${isToday ? 'bg-accent font-semibold text-white' : 'text-text'}`}
              >
                {format.dayNumber(day)}
              </span>
            </button>
          );
        })}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        <div className="relative flex" style={{ height: HOURS.length * pxPerHour }}>
          <div className="relative shrink-0" style={{ width: GUTTER }}>
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-faint"
                style={{ top: hour * pxPerHour }}
              >
                {hour === 0 ? '' : format.hourLabel(hour)}
              </span>
            ))}
          </div>

          <div className="relative flex flex-1">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="pointer-events-none absolute inset-x-0 hairline-t"
                style={{ top: hour * pxPerHour }}
              />
            ))}

            {days.map((day) => (
              <div
                key={day}
                onClick={() => onSelectDay(day)}
                className={`relative min-w-0 flex-1 hairline-l ${
                  day === selectedDay ? 'bg-[var(--accent-soft)]/50' : ''
                }`}
              >
                {day === currentDay && nowOffset !== undefined && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 z-10 border-t border-[var(--danger)]"
                    style={{ top: nowOffset }}
                  >
                    <span className="absolute -left-[3px] -top-[3px] h-[6px] w-[6px] rounded-full bg-[var(--danger)]" />
                  </div>
                )}

                {layout(grouped.get(day) ?? [], format).map(({ event, column, columns }) => {
                  const { start, end } = eventMinutes(event, format);
                  const top = (start / 60) * pxPerHour;
                  const height = Math.max(((end - start) / 60) * pxPerHour - 2, 18);
                  const color = sourceColor(definitions, event.sourceId);
                  const dimmed = event.availability === 'soldout' || isPast(event);
                  const selected = selectedEventId === event.id;

                  return (
                    <button
                      key={event.id}
                      type="button"
                      data-event-id={event.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(event);
                      }}
                      title={`${event.allDay ? t('allDay') : format.time(event.start)} · ${event.title} · ${event.venue.name}`}
                      className="absolute overflow-hidden rounded-[var(--radius-sm)] px-1.5 py-[3px] text-left"
                      style={{
                        top,
                        height,
                        left: `calc(${(column / columns) * 100}% + 2px)`,
                        width: `calc(${100 / columns}% - 4px)`,
                        background: selected ? color : `color-mix(in srgb, ${color} 10%, var(--canvas))`,
                        color: selected ? '#fff' : 'var(--text)',
                        boxShadow: `inset 2px 0 0 ${selected ? 'rgba(255,255,255,0.6)' : color}`,
                        opacity: dimmed && !selected ? 0.6 : 1,
                      }}
                    >
                      <span className="block truncate text-[12px] font-medium leading-tight">
                        {event.title}
                      </span>
                      {height > 30 && (
                        <span
                          className="block truncate text-[11px] leading-tight"
                          style={{ color: selected ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)' }}
                        >
                          {/* Ein Lauf hat keine Uhrzeit und sitzt im Raster
                              nur mangels besserer Stelle oben – das Wort sagt,
                              dass die Lage nichts bedeutet. */}
                          {`${event.allDay ? t('allDay') : format.time(event.start)} · ${event.venue.name}`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Position der Jetzt-Linie, minütlich aktualisiert. */
function useNowOffset(pxPerHour: number, format: { minutesOfDay: (iso: string) => number }) {
  const [minutes, setMinutes] = useState<number>();

  useEffect(() => {
    const tick = () => setMinutes(format.minutesOfDay(new Date().toISOString()));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [format]);

  return minutes === undefined ? undefined : (minutes / 60) * pxPerHour;
}

/** Überlappende Termine nebeneinander legen. */
function layout(events: CalendarEvent[], format: Parameters<typeof eventMinutes>[1]) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const placed: { event: CalendarEvent; column: number; columns: number }[] = [];

  let cluster: typeof placed = [];
  let clusterEnd = -1;

  const flush = () => {
    const columns = cluster.reduce((max, item) => Math.max(max, item.column + 1), 1);
    for (const item of cluster) item.columns = columns;
    placed.push(...cluster);
    cluster = [];
    clusterEnd = -1;
  };

  for (const event of sorted) {
    const { start, end } = eventMinutes(event, format);
    if (cluster.length && start >= clusterEnd) flush();

    const taken = new Set(
      cluster
        .filter((item) => eventMinutes(item.event, format).end > start)
        .map((item) => item.column),
    );
    let column = 0;
    while (taken.has(column)) column++;

    cluster.push({ event, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) flush();

  return placed;
}
