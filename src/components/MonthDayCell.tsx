'use client';

import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { isPast, sourceColor } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';

interface Props {
  day: string;
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selected: boolean;
  isToday: boolean;
  selectedEventId?: string;
  onSelectDay: (day: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  /**
   * Gehört der Tag nicht zum angezeigten Monat? Nur im festen Raster relevant.
   * Solche Tage treten als Ganzes zurück – Fläche, Ziffer und Punkte –, damit
   * die Grenze des Monats ohne Hinsehen erkennbar ist.
   */
  outside?: boolean;
  /** Nur Punkte statt Titel – für die Mobilansicht. */
  compact?: boolean;
  /** Monatsnamen neben der Ziffer zeigen (Monatsanfang im Endlos-Scroll). */
  showMonth?: boolean;
  maxEvents?: number;
}

/** Eine Zelle des Monatsrasters – geteilt von fester und scrollender Ansicht. */
export function MonthDayCell({
  day,
  events,
  definitions,
  selected,
  isToday,
  selectedEventId,
  onSelectDay,
  onSelectEvent,
  outside = false,
  compact = false,
  showMonth = false,
  maxEvents = 4,
}: Props) {
  const { format, t } = useSettings();

  return (
    <div
      role="gridcell"
      tabIndex={0}
      aria-label={format.dayLong(day)}
      aria-selected={selected}
      onClick={() => onSelectDay(day)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectDay(day);
        }
      }}
      className={`flex min-h-0 cursor-pointer flex-col gap-[3px] overflow-hidden px-1.5 pb-1 pt-1
                  hairline-r hairline-b transition-colors
                  ${
                    selected
                      ? 'bg-[var(--accent-soft)]'
                      : outside
                        ? 'bg-[var(--sunken)]'
                        : 'hover:bg-[var(--chrome)]'
                  }`}
    >
      <div className="flex shrink-0 items-baseline gap-1">
        <span
          className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[12px] tabular-nums
                      ${isToday ? 'bg-accent font-semibold text-white' : outside ? 'text-faint' : 'text-muted'}`}
        >
          {format.dayNumber(day)}
        </span>
        {showMonth && (
          <span className="truncate text-[11px] font-medium text-text">
            {format.monthName(day)}
          </span>
        )}
      </div>

      {compact ? (
        <div className="flex flex-wrap gap-[3px]">
          {events.slice(0, 6).map((event) => (
            <span
              key={event.id}
              className="h-[5px] w-[5px] rounded-full"
              style={{
                background: sourceColor(definitions, event.sourceId),
                opacity: outside ? 0.3 : isPast(event) ? 0.35 : 1,
              }}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-col gap-[2px] overflow-hidden">
          {events.slice(0, maxEvents).map((event) => {
            // Vergangenes und Ausverkauftes tritt zurück, verschwindet aber nicht.
            const dimmed = isPast(event) || event.availability === 'soldout';
            return (
              <button
                key={event.id}
                type="button"
                data-event-id={event.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEvent(event);
                }}
                title={`${event.allDay ? '' : format.time(event.start) + ' '}${event.title} · ${event.venue.name}`}
                className={`flex items-center gap-1.5 rounded-[var(--radius-xs)] px-1 py-[1px] text-left
                            ${
                              selectedEventId === event.id
                                ? 'bg-[var(--canvas)] shadow-[0_0_0_1px_var(--line-strong)]'
                                : 'hover:bg-[var(--canvas)]'
                            }`}
              >
                <span
                  aria-hidden="true"
                  className="h-[5px] w-[5px] shrink-0 rounded-full"
                  style={{
                    background: sourceColor(definitions, event.sourceId),
                    opacity: dimmed ? 0.35 : 1,
                  }}
                />
                {!event.allDay && (
                  <span className={`shrink-0 text-[11px] tabular-nums ${dimmed ? 'opacity-60' : ''} text-faint`}>
                    {format.time(event.start)}
                  </span>
                )}
                <span
                  className={`truncate text-[12px] ${
                    dimmed ? 'text-faint' : outside ? 'text-muted' : 'text-text'
                  }`}
                >
                  {event.title}
                </span>
              </button>
            );
          })}
          {events.length > maxEvents && (
            <span className="px-1 text-[11px] text-faint">
              {t('more', { count: events.length - maxEvents })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
