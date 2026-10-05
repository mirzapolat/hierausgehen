'use client';

import { useMemo } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { isSameMonth, monthGrid } from '@/lib/calendar';
import { byDay, splitSpans } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { MonthDayCell } from './MonthDayCell';

interface Props {
  anchor: string;
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedDay: string;
  selectedEventId?: string;
  onSelectDay: (day: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  /** Kompakte Tönung statt Titelzeilen (Mobile). */
  compact?: boolean;
  /**
   * Nur die Woche des gewählten Tages zeigen (Mobile, während die Liste
   * darunter gescrollt wird). Das Raster bleibt dasselbe und rückt nur
   * nach oben – so lässt sich der Übergang animieren.
   */
  collapsed?: boolean;
  /** Weitere Termine derselben Produktion wie der gewählte. */
  relatedIds?: ReadonlySet<string>;
}

/** Höhe der Wochentagszeile und einer Woche im kompakten Raster (px). */
export const COMPACT_HEAD = 24;
export const COMPACT_ROW = 44;

/** Die Wochen des Rasters, die wenigstens einen Tag des Monats enthalten. */
export function monthWeeks(anchor: string): string[][] {
  const days = monthGrid(anchor);
  return Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7)).filter((week) =>
    week.some((day) => isSameMonth(day, anchor)),
  );
}

/** Festes 6×7-Raster eines Monats. Auf dem Desktop scrollt stattdessen `MonthScrollView`. */
export function MonthView({
  anchor,
  events,
  definitions,
  selectedDay,
  selectedEventId,
  onSelectDay,
  onSelectEvent,
  compact = false,
  collapsed = false,
  relatedIds,
}: Props) {
  const { format } = useSettings();
  // Bewusst immer das Raster des Ankermonats: die Ansicht bleibt beim Monat
  // stehen, statt sich um den gewählten Tag herum neu zu ordnen.
  const days = useMemo(() => monthGrid(anchor), [anchor]);
  // Kompakt nur die Wochen, die zum Monat gehören – eine Zeile ganz aus dem
  // Nachbarmonat wäre Fläche ohne Auskunft.
  const weeks = useMemo(
    () => (compact ? monthWeeks(anchor) : Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7))),
    [compact, anchor, days],
  );
  // Mehrtägiges bleibt draussen – es steht in der Liste des Tages.
  const grouped = useMemo(() => byDay(splitSpans(events, format).single, format), [events, format]);
  const busiest = useMemo(
    () => Math.max(0, ...days.filter((day) => isSameMonth(day, anchor)).map((day) => grouped.get(day)?.length ?? 0)),
    [days, anchor, grouped],
  );
  const currentDay = format.today();
  const focusWeek = Math.max(0, weeks.findIndex((week) => week.includes(selectedDay)));

  return (
    <div className="flex h-full flex-col">
      <div
        className={`grid shrink-0 grid-cols-7 hairline-b ${compact ? 'items-center' : ''}`}
        style={compact ? { height: COMPACT_HEAD } : undefined}
      >
        {days.slice(0, 7).map((day) => (
          <div
            key={day}
            className={`px-2 text-[11px] font-medium uppercase tracking-[0.05em] text-faint ${compact ? '' : 'py-1.5'}`}
          >
            {format.weekdayShort(day)}
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          className={`flex flex-col ${compact ? 'transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]' : 'h-full'}`}
          style={compact ? { transform: `translateY(${collapsed ? -focusWeek * COMPACT_ROW : 0}px)` } : undefined}
        >
          {weeks.map((week) => (
            <div
              key={week[0]}
              className={`grid grid-cols-7 ${compact ? '' : 'min-h-0 flex-1'}`}
              style={compact ? { height: COMPACT_ROW } : undefined}
            >
              {week.map((day) => (
                <MonthDayCell
                  key={day}
                  day={day}
                  events={grouped.get(day) ?? []}
                  definitions={definitions}
                  selected={day === selectedDay}
                  isToday={day === currentDay}
                  selectedEventId={selectedEventId}
                  onSelectDay={onSelectDay}
                  onSelectEvent={onSelectEvent}
                  outside={!isSameMonth(day, anchor)}
                  compact={compact}
                  busiest={busiest}
                  relatedIds={relatedIds}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
