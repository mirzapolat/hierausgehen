'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths } from '@/lib/calendar';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { useSettings } from '@/lib/settings/context';
import { DayAgenda } from './AgendaList';
import { COMPACT_HEAD, COMPACT_ROW, MonthView, monthWeeks } from './MonthView';
import { MOTION } from './motion';
import { SwipePager } from './SwipePager';

/** So weit (px) scrollt die Tagesliste, bevor der Monat auf die Woche einklappt. */
const COLLAPSE_AFTER = 24;

interface Props {
  anchor: string;
  events: CalendarEvent[];
  /** Was am gewählten Tag läuft – die Liste unter dem Monat. */
  dayEvents: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedDay: string;
  selectedEventId?: string;
  relatedIds?: ReadonlySet<string>;
  onSelectDay: (day: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onStep: (direction: -1 | 1) => void;
  onPreview: (direction: -1 | 0 | 1) => void;
  canStep: (direction: -1 | 1) => boolean;
}

/**
 * Der Monat auf dem Telefon: oben das kompakte Raster, darunter die Liste
 * des gewählten Tages.
 *
 * Wischen blättert den Monat – wie in Tages- und Wochenansicht. Wer die Liste
 * darunter liest, braucht vom Monat nur noch die Woche: das Raster klappt beim
 * Scrollen auf sie ein, und der Griff dazwischen lässt sich ziehen oder tippen.
 */
export function MobileMonth({
  anchor,
  events,
  dayEvents,
  definitions,
  selectedDay,
  selectedEventId,
  relatedIds,
  onSelectDay,
  onSelectEvent,
  onStep,
  onPreview,
  canStep,
}: Props) {
  const { t } = useSettings();
  /** Der Monat ist auf die Woche des gewählten Tages eingeklappt. */
  const [collapsed, setCollapsed] = useState(false);

  /**
   * Scrollt die Tagesliste nach unten, klappt der Monat auf die Woche ein;
   * ganz oben angekommen, wieder auf. Eingeklappt wird nur, wenn die Liste
   * danach noch scrollen kann – sonst stünde sie gleich wieder oben, und der
   * Monat spränge hin und her.
   */
  const agendaScroller = useRef<HTMLDivElement>(null);
  /** Wochen des angezeigten Monats – vier bis sechs, je nachdem wie er fällt. */
  const rows = useMemo(() => monthWeeks(anchor).length, [anchor]);
  const collapseRange = (rows - 1) * COMPACT_ROW;

  const onAgendaScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    if (collapsed) {
      if (element.scrollTop <= 0) setCollapsed(false);
      return;
    }
    const room = element.scrollHeight - element.clientHeight;
    if (element.scrollTop > COLLAPSE_AFTER && room > collapseRange + COLLAPSE_AFTER) setCollapsed(true);
  };

  /**
   * Der Griff unter dem Monat lässt sich ziehen, wie der des Sheets. Nach oben
   * klappt der Monat auf die Woche ein, nach unten wieder auf; das Raster
   * folgt dabei dem Finger (`gripProgress`, 0 = Monat, 1 = Woche).
   * Losgelassen rastet es ein: mit dem Schwung des Fingers, sonst nach der
   * halben Strecke. Ein Tippen schaltet wie bisher um.
   */
  const [gripProgress, setGripProgress] = useState<number | null>(null);
  const grip = useRef({ startY: 0, start: 0, lastY: 0, lastTime: 0, velocity: 0, dragging: false });

  const onGripStart = (e: React.TouchEvent) => {
    const y = e.touches[0].clientY;
    grip.current = {
      startY: y,
      start: collapsed ? 1 : 0,
      lastY: y,
      lastTime: e.timeStamp,
      velocity: 0,
      dragging: false,
    };
  };

  const onGripMove = (e: React.TouchEvent) => {
    const g = grip.current;
    const y = e.touches[0].clientY;
    if (!g.dragging && Math.abs(y - g.startY) < 4) return;
    g.dragging = true;
    const elapsed = e.timeStamp - g.lastTime;
    if (elapsed > 0) g.velocity = 0.7 * ((y - g.lastY) / elapsed) + 0.3 * g.velocity;
    g.lastY = y;
    g.lastTime = e.timeStamp;
    setGripProgress(Math.min(1, Math.max(0, g.start - (y - g.startY) / collapseRange)));
  };

  const onGripEnd = (e: React.TouchEvent) => {
    const g = grip.current;
    if (!g.dragging) return;
    // Kein Klick hinterher, der würde gleich wieder umschalten.
    e.preventDefault();
    g.dragging = false;
    const velocity = e.timeStamp - g.lastTime > 80 ? 0 : g.velocity;
    const progress = gripProgress ?? g.start;
    const collapse = velocity < -0.3 ? true : velocity > 0.3 ? false : progress > 0.5;
    setCollapsed(collapse);
    setGripProgress(null);
    if (!collapse) agendaScroller.current?.scrollTo({ top: 0 });
  };

  /** Wie weit der Monat gerade eingeklappt ist, gezogen oder eingerastet. */
  const progress = gripProgress ?? (collapsed ? 1 : 0);

  // Ein anderer Monat bringt das ganze Raster zurück – seine Woche wäre sonst geraten.
  const month = anchor.slice(0, 7);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(false);
  }, [month]);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:hidden">
      <div
        // Während des Ziehens folgt die Höhe dem Finger ohne Übergang.
        className={`shrink-0 overflow-hidden ${gripProgress === null ? `${MOTION} transition-[height]` : ''}`}
        style={{ height: COMPACT_HEAD + (rows - progress * (rows - 1)) * COMPACT_ROW }}
      >
        <SwipePager
          anchor={anchor}
          pageAnchor={(offset) => addMonths(anchor, offset)}
          onStep={onStep}
          onPreview={onPreview}
          // Eingeklappt gehört die Geste der Woche, nicht dem Monat.
          canStep={collapsed ? () => false : canStep}
          label={t('month')}
          className="flex h-full scroll-hidden"
        >
          {(pageAnchor) => (
            <MonthView
              compact
              collapsed={collapsed}
              collapseProgress={gripProgress ?? undefined}
              anchor={pageAnchor}
              events={events}
              definitions={definitions}
              selectedDay={selectedDay}
              selectedEventId={selectedEventId}
              onSelectDay={onSelectDay}
              onSelectEvent={onSelectEvent}
              relatedIds={relatedIds}
            />
          )}
        </SwipePager>
      </div>
      <button
        type="button"
        onClick={() => {
          setCollapsed((current) => !current);
          if (collapsed) agendaScroller.current?.scrollTo({ top: 0 });
        }}
        onTouchStart={onGripStart}
        onTouchMove={onGripMove}
        onTouchEnd={onGripEnd}
        onTouchCancel={onGripEnd}
        aria-label={collapsed ? t('monthExpand') : t('monthCollapse')}
        aria-expanded={!collapsed}
        // Gut zu treffen wie der Griff des Sheets: ein breiter Streifen,
        // sichtbar nur als Linie. `touch-none`, damit der Browser die Geste
        // nicht selbst als Bildlauf nimmt.
        className="grid h-6 shrink-0 touch-none place-items-center hairline-b"
      >
        <span className="h-[5px] w-10 rounded-full bg-[var(--line-strong)]" />
      </button>
      <div
        ref={agendaScroller}
        onScroll={onAgendaScroll}
        className="min-h-0 flex-1 overflow-y-auto scroll-quiet pb-safe"
      >
        <DayAgenda
          events={dayEvents}
          definitions={definitions}
          selectedId={selectedEventId}
          onSelect={onSelectEvent}
          emptyLabel={t('noEventsDay')}
          day={selectedDay}
          relatedIds={relatedIds}
        />
      </div>
    </div>
  );
}
