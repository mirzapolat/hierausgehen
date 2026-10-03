'use client';

import type { SpanSegment } from '@/lib/calendar';
import type { EventSpan } from '@/lib/events/display';
import { isPast, sourceColor } from '@/lib/events/display';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { useSettings } from '@/lib/settings/context';

interface Props {
  segments: SpanSegment<EventSpan>[];
  definitions: SourceDefinition[];
  selectedEventId?: string;
  relatedIds?: ReadonlySet<string>;
  onSelectEvent: (event: CalendarEvent) => void;
  /** Höhe einer Spur in px – der Abstand zwischen den Spuren ist darin enthalten. */
  laneHeight: number;
}

/**
 * Mehrtägige Termine als Balken über den Tagen einer Woche.
 *
 * Die Balken liegen in einem eigenen Raster aus sieben Spalten über den
 * Zellen. Gerade Kanten heissen: es geht in der Nachbarwoche weiter; der
 * farbige Strich steht nur dort, wo der Termin wirklich beginnt.
 */
export function SpanBars({
  segments,
  definitions,
  selectedEventId,
  relatedIds,
  onSelectEvent,
  laneHeight,
}: Props) {
  const { format, t } = useSettings();

  return (
    <div className="pointer-events-none grid grid-cols-7" style={{ gridAutoRows: laneHeight }}>
      {segments.map(({ span, lane, startColumn, endColumn, continuesBefore, continuesAfter }) => {
        const { event } = span;
        const color = sourceColor(definitions, event.sourceId);
        const selected = selectedEventId === event.id;
        const related = !selected && relatedIds?.has(event.id);
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
            title={`${event.title} · ${format.dayNumeric(span.from)}–${format.dayNumeric(span.to)} · ${event.venue.name}`}
            aria-label={`${event.title}, ${t('until', { day: format.dayNumeric(span.to) })}`}
            className={`pointer-events-auto flex min-w-0 items-center self-start px-1.5 text-left
                        ${continuesBefore ? 'rounded-l-none' : 'ml-[3px] rounded-l-[var(--radius-xs)]'}
                        ${continuesAfter ? 'rounded-r-none' : 'mr-[3px] rounded-r-[var(--radius-xs)]'}`}
            style={{
              gridColumn: `${startColumn + 1} / ${endColumn + 2}`,
              gridRow: lane + 1,
              height: laneHeight - 2,
              background: selected
                ? color
                : `color-mix(in srgb, ${color} ${related ? 32 : 13}%, var(--canvas))`,
              boxShadow: continuesBefore
                ? undefined
                : `inset 2px 0 0 ${selected ? 'rgba(255,255,255,0.6)' : color}`,
              color: selected ? '#fff' : 'var(--text)',
              opacity: dimmed && !selected ? 0.6 : 1,
            }}
          >
            <span className={`truncate text-[11px] leading-none ${related ? 'font-semibold' : 'font-medium'}`}>
              {event.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
