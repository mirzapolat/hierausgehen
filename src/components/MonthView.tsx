'use client';

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { isSameMonth, layoutSpans, monthGrid } from '@/lib/calendar';
import { byDay, splitSpans, type EventSpan } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { MonthDayCell } from './MonthDayCell';
import { SpanBars } from './SpanBars';

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
  /** Weitere Termine derselben Produktion wie der gewählte. */
  relatedIds?: ReadonlySet<string>;
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
  relatedIds,
}: Props) {
  const { format } = useSettings();
  // Bewusst immer das Raster des Ankermonats: die Ansicht bleibt beim Monat
  // stehen, statt sich um den gewählten Tag herum neu zu ordnen.
  const days = useMemo(() => monthGrid(anchor), [anchor]);
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7)), [days]);
  // Auf dem Telefon keine Linien: Mehrtägiges ist dort ein Punkt am ersten
  // Tag wie jeder andere Termin; was an einem Tag noch läuft, zeigt die Liste.
  const { single, spans } = useMemo(
    () => (compact ? { single: events, spans: [] } : splitSpans(events, format)),
    [compact, events, format],
  );
  const grouped = useMemo(() => byDay(single, format), [single, format]);
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

      <div className="flex min-h-0 flex-1 flex-col">
        {weeks.map((week) => (
          <WeekSpans
            key={week[0]}
            days={week}
            spans={spans}
            definitions={definitions}
            selectedEventId={selectedEventId}
            relatedIds={relatedIds}
            onSelectEvent={onSelectEvent}
            className="grid min-h-0 flex-1 grid-cols-7"
          >
            {(day, { spanSpace, hiddenSpans, lanes }) => (
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
                spanSpace={spanSpace}
                hiddenSpans={compact ? 0 : hiddenSpans}
                maxEvents={4 - lanes}
                relatedIds={relatedIds}
              />
            )}
          </WeekSpans>
        ))}
      </div>
    </div>
  );
}

/** Abstand vom oberen Zellrand bis unter die Tagesziffer (pt-1 + Ziffer + Abstand). */
const CELL_HEAD = 27;
/** Spurhöhe der Balken. */
const BAR_LANE = 18;
/** Mehr Spuren nimmt keine Woche auf – sonst bliebe für einzelne Termine kein Platz. */
const MAX_LANES = 2;

interface DaySpace {
  /** Platz, den die Zelle unter ihrer Ziffer für die Balken freihält (px). */
  spanSpace: number;
  /** Mehrtägige Termine dieses Tages ohne eigenen Balken. */
  hiddenSpans: number;
  /** Belegte Spuren in dieser Woche. */
  lanes: number;
}

/**
 * Eine Wochenzeile des Monatsrasters samt den Balken mehrtägiger Termine.
 *
 * Die Zellen bleiben, was sie sind; die Balken liegen in einer Ebene darüber,
 * direkt unter den Tagesziffern, und die Zellen halten dafür Platz frei.
 */
export function WeekSpans({
  days,
  spans,
  definitions,
  selectedEventId,
  relatedIds,
  onSelectEvent,
  className,
  style,
  children,
}: {
  days: string[];
  spans: EventSpan[];
  definitions: SourceDefinition[];
  selectedEventId?: string;
  relatedIds?: ReadonlySet<string>;
  onSelectEvent: (event: CalendarEvent) => void;
  className?: string;
  style?: CSSProperties;
  children: (day: string, space: DaySpace) => ReactNode;
}) {
  const { segments, hidden, lanes } = useMemo(
    () => layoutSpans(spans, days, MAX_LANES),
    [spans, days],
  );
  const used = Math.min(lanes, MAX_LANES);
  const spanSpace = used > 0 ? used * BAR_LANE - 3 : 0;

  return (
    <div className={`relative ${className ?? ''}`} style={style}>
      {days.map((day) =>
        children(day, {
          spanSpace,
          hiddenSpans: hidden.filter((span) => span.from <= day && span.to >= day).length,
          lanes: used,
        }),
      )}

      {segments.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0" style={{ top: CELL_HEAD }}>
          <SpanBars
            segments={segments}
            definitions={definitions}
            selectedEventId={selectedEventId}
            relatedIds={relatedIds}
            onSelectEvent={onSelectEvent}
            laneHeight={BAR_LANE}
          />
        </div>
      )}
    </div>
  );
}
