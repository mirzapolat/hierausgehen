'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { addDays, startOfWeek } from '@/lib/calendar';
import { byDay, splitSpans } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { MonthDayCell } from './MonthDayCell';
import { WeekSpans } from './MonthView';

interface Props {
  anchor: string;
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedDay: string;
  selectedEventId?: string;
  onSelectDay: (day: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  /** Meldet den Monat, der oben im Bild steht – die Kopfzeile folgt ihm. */
  onAnchorChange: (day: string) => void;
  /** Erhobener Zeitraum; darüber hinaus gibt es nichts zu scrollen. */
  coverage: { from: string; to: string };
  /** Erzwingt einen Sprung zum Anker, auch wenn der Monat gleich bleibt. */
  focusKey?: number;
  /** Weitere Termine derselben Produktion wie der gewählte. */
  relatedIds?: ReadonlySet<string>;
}

/** Feste Zeilenhöhe: nur damit lässt sich exakt an eine Woche scrollen. */
const ROW_HEIGHT = 132;

/**
 * Durchgehend scrollender Monatskalender.
 *
 * Statt Monat für Monat zu blättern, hängen alle Wochen des erhobenen
 * Zeitraums untereinander – zwölf Monate, mehr hält der Server nicht vor. Die
 * Kopfzeile zeigt den Monat, der gerade oben steht; Pfeile, „Heute" und
 * Deeplinks springen weiterhin gezielt an eine Stelle.
 */
/** Wievielte Woche des Fensters enthält diesen Tag? */
function weekIndex(first: string, day: string): number {
  return Math.round(
    (Date.parse(`${startOfWeek(day)}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) /
      (7 * 86_400_000),
  );
}

export function MonthScrollView({
  anchor,
  events,
  definitions,
  selectedDay,
  selectedEventId,
  onSelectDay,
  onSelectEvent,
  onAnchorChange,
  coverage,
  focusKey = 0,
  relatedIds,
}: Props) {
  const { format } = useSettings();
  const { single, spans } = useMemo(() => splitSpans(events, format), [events, format]);
  const grouped = useMemo(() => byDay(single, format), [single, format]);
  const currentDay = format.today();

  const scroller = useRef<HTMLDivElement>(null);

  const weeks = useMemo(() => {
    const first = startOfWeek(coverage.from);
    const count = weekIndex(first, coverage.to) + 1;
    return Array.from({ length: count }, (_, i) => addDays(first, i * 7));
  }, [coverage]);

  /** Monat, den wir zuletzt selbst gemeldet haben – verhindert Rückkopplung. */
  const reported = useRef('');
  /** Letzter ausdrücklicher Fokusauftrag von aussen. */
  const focused = useRef(focusKey);
  /** Während eines eigenen Sprungs keine Scroll-Ereignisse auswerten. */
  const suppress = useRef(false);

  /**
   * Anker von aussen (Pfeile, „Heute", Deeplink): an die Stelle springen.
   *
   * Genau der Fall, für den Effekte gedacht sind – React mit einem externen
   * System abgleichen, hier der Scrollposition des Containers.
   */
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const month = anchor.slice(0, 7);
    // Kam die Änderung aus unserem eigenen Scrollen, ist nichts zu tun.
    const shouldFocus = focusKey !== focused.current;
    if (month === reported.current && !shouldFocus) return;
    reported.current = month;
    focused.current = focusKey;

    suppress.current = true;
    element.scrollTop = Math.max(0, weekIndex(weeks[0], anchor) * ROW_HEIGHT);
    requestAnimationFrame(() => {
      suppress.current = false;
    });
  }, [anchor, focusKey, weeks]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element || suppress.current) return;

    // Die zweite sichtbare Zeile bestimmt den Monat in der Kopfzeile.
    const row = weeks[Math.floor(element.scrollTop / ROW_HEIGHT) + 1] ?? weeks.at(-1);
    if (!row) return;
    const month = addDays(row, 3).slice(0, 7);
    if (month !== reported.current) {
      reported.current = month;
      onAnchorChange(`${month}-01`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="grid shrink-0 grid-cols-7 overflow-y-auto scroll-quiet hairline-b"
        style={{ scrollbarGutter: 'stable' }}
      >
        {weeks[0] &&
          Array.from({ length: 7 }, (_, i) => addDays(weeks[0], i)).map((day) => (
            <div
              key={day}
              className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-faint"
            >
              {format.weekdayShort(day)}
            </div>
          ))}
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto scroll-quiet"
        style={{ scrollbarGutter: 'stable' }}
      >
        {weeks.map((weekStart) => {
          const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
          // Zeilen, in denen ein Monat beginnt, bekommen eine kräftigere Linie.
          const startsMonth = days.some((day) => day.endsWith('-01'));
          return (
            <WeekSpans
              key={weekStart}
              days={days}
              spans={spans}
              definitions={definitions}
              selectedEventId={selectedEventId}
              relatedIds={relatedIds}
              onSelectEvent={onSelectEvent}
              className="grid grid-cols-7"
              style={{
                height: ROW_HEIGHT,
                borderTop: startsMonth ? '1px solid var(--line-strong)' : undefined,
              }}
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
                  showMonth={day.endsWith('-01')}
                  spanSpace={spanSpace}
                  hiddenSpans={hiddenSpans}
                  maxEvents={4 - lanes}
                  relatedIds={relatedIds}
                />
              )}
            </WeekSpans>
          );
        })}
      </div>
    </div>
  );
}
