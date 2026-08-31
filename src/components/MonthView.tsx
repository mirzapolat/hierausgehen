'use client';

import { useMemo } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { addDays, isSameMonth, monthGrid, startOfWeek } from '@/lib/calendar';
import { byDay } from '@/lib/events/display';
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
  /** Kompakte Punktdarstellung statt Titelzeilen (Mobile). */
  compact?: boolean;
  /** Den Ankertag in die erste sichtbare Woche setzen. */
  currentWeekFirst?: boolean;
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
  currentWeekFirst = false,
}: Props) {
  const { format } = useSettings();
  const days = useMemo(
    () =>
      currentWeekFirst
        ? Array.from({ length: 42 }, (_, index) => addDays(startOfWeek(anchor), index))
        : monthGrid(anchor),
    [anchor, currentWeekFirst],
  );
  const grouped = useMemo(() => byDay(events, format), [events, format]);
  const currentDay = format.today();

  return (
    <div className="flex h-full flex-col">
      <div className="grid shrink-0 grid-cols-7 hairline-b">
        {days.slice(0, 7).map((day) => (
          <div
            key={day}
            className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-faint"
          >
            {format.weekdayShort(day)}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => (
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
          />
        ))}
      </div>
    </div>
  );
}
