'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { addDays, startOfMonth, startOfWeek } from '@/lib/calendar';
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
  /** Meldet den Monat, der oben im Bild steht – die Kopfzeile folgt ihm. */
  onAnchorChange: (day: string) => void;
}

/** Feste Zeilenhöhe: nur damit lässt sich beim Nachladen exakt nachscrollen. */
const ROW_HEIGHT = 132;
/** Wochen, die je Nachladevorgang oben oder unten dazukommen. */
const CHUNK = 8;
/** Obergrenze, damit der Baum bei langem Scrollen nicht unbegrenzt wächst. */
const MAX_WEEKS = 240;
const INITIAL_BEFORE = 12;
const INITIAL_AFTER = 32;

/**
 * Durchgehend scrollender Monatskalender.
 *
 * Statt Monat für Monat zu blättern, hängt die Ansicht beim Erreichen des
 * Randes weitere Wochen an und schneidet am anderen Ende ab. Die Kopfzeile
 * zeigt den Monat, der gerade oben steht; Pfeile, „Heute" und Deeplinks
 * springen weiterhin gezielt an eine Stelle.
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
}: Props) {
  const { format } = useSettings();
  const grouped = useMemo(() => byDay(events, format), [events, format]);
  const currentDay = format.today();

  const scroller = useRef<HTMLDivElement>(null);
  const [window_, setWindow] = useState(() => ({
    first: addDays(startOfWeek(startOfMonth(anchor)), -INITIAL_BEFORE * 7),
    count: INITIAL_BEFORE + INITIAL_AFTER,
  }));

  /** Nach dem nächsten Layout auszuführende Scrollkorrektur. */
  const pending = useRef<{ top?: number; delta?: number }>({ top: INITIAL_BEFORE * ROW_HEIGHT });
  /** Monat, den wir zuletzt selbst gemeldet haben – verhindert Rückkopplung. */
  const reported = useRef(anchor.slice(0, 7));
  /** Während eines eigenen Sprungs keine Scroll-Ereignisse auswerten. */
  const suppress = useRef(false);

  const weeks = useMemo(
    () => Array.from({ length: window_.count }, (_, i) => addDays(window_.first, i * 7)),
    [window_],
  );

  // Ausstehende Scrollkorrekturen anwenden, bevor der Browser zeichnet.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const { top, delta } = pending.current;
    if (top !== undefined) element.scrollTop = top;
    else if (delta) element.scrollTop += delta;
    pending.current = {};
    if (top !== undefined || delta) {
      suppress.current = true;
      requestAnimationFrame(() => {
        suppress.current = false;
      });
    }
  }, [window_]);

  /**
   * Anker von aussen (Pfeile, „Heute", Deeplink): an die Stelle springen.
   *
   * Genau der Fall, für den Effekte gedacht sind – React mit einem externen
   * System abgleichen, hier der Scrollposition des Containers. Liegt das Ziel
   * ausserhalb der geladenen Wochen, muss dabei auch das Fenster neu gesetzt
   * werden; die Regel unten kann diesen Fall nicht von einer Kaskade
   * unterscheiden.
   */
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const month = anchor.slice(0, 7);
    // Kam die Änderung aus unserem eigenen Scrollen, ist nichts zu tun.
    if (month === reported.current) return;
    reported.current = month;

    const target = weekIndex(window_.first, startOfMonth(anchor));
    if (target >= 1 && target <= window_.count - 6) {
      suppress.current = true;
      element.scrollTop = target * ROW_HEIGHT;
      requestAnimationFrame(() => {
        suppress.current = false;
      });
      return;
    }

    pending.current = { top: INITIAL_BEFORE * ROW_HEIGHT };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWindow({
      first: addDays(startOfWeek(startOfMonth(anchor)), -INITIAL_BEFORE * 7),
      count: INITIAL_BEFORE + INITIAL_AFTER,
    });
  }, [anchor, window_]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element || suppress.current) return;

    // Oben nachlegen und am unteren Ende abschneiden – und umgekehrt.
    if (element.scrollTop < ROW_HEIGHT * 3) {
      const trim = window_.count + CHUNK > MAX_WEEKS ? CHUNK : 0;
      pending.current = { delta: CHUNK * ROW_HEIGHT };
      setWindow((w) => ({ first: addDays(w.first, -CHUNK * 7), count: w.count + CHUNK - trim }));
      return;
    }
    if (element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT * 3) {
      const trim = window_.count + CHUNK > MAX_WEEKS ? CHUNK : 0;
      pending.current = trim ? { delta: -trim * ROW_HEIGHT } : {};
      setWindow((w) => ({
        first: trim ? addDays(w.first, trim * 7) : w.first,
        count: w.count + CHUNK - trim,
      }));
      return;
    }

    // Die zweite sichtbare Zeile bestimmt den Monat in der Kopfzeile.
    const row = weeks[Math.floor(element.scrollTop / ROW_HEIGHT) + 1];
    if (!row) return;
    const month = addDays(row, 3).slice(0, 7);
    if (month !== reported.current) {
      reported.current = month;
      onAnchorChange(`${month}-01`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-7 hairline-b">
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

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        {weeks.map((weekStart) => {
          const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
          // Zeilen, in denen ein Monat beginnt, bekommen eine kräftigere Linie.
          const startsMonth = days.some((day) => day.endsWith('-01'));
          return (
            <div
              key={weekStart}
              className="grid grid-cols-7"
              style={{
                height: ROW_HEIGHT,
                borderTop: startsMonth ? '1px solid var(--line-strong)' : undefined,
              }}
            >
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
                  showMonth={day.endsWith('-01')}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
