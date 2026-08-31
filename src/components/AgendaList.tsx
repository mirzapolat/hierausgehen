'use client';

import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { displayAvailability, sourceColor } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { AvailabilityDot } from './AvailabilityDot';

interface Props {
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedId?: string;
  onSelect: (event: CalendarEvent) => void;
  emptyLabel?: string;
}

/**
 * Terminliste eines Tages. Wird in der Detailspalte und mobil verwendet –
 * eine Darstellung, ein Verhalten.
 */
export function AgendaList({ events, definitions, selectedId, onSelect, emptyLabel }: Props) {
  const { format, t } = useSettings();

  if (events.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-faint">{emptyLabel ?? t('noEvents')}</p>;
  }

  return (
    <ul className="flex flex-col">
      {events.map((event) => (
        <li key={event.id}>
          <button
            type="button"
            onClick={() => onSelect(event)}
            aria-current={selectedId === event.id}
            className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hairline-b
                        ${selectedId === event.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--chrome)]'}`}
          >
            <span className="w-[52px] shrink-0 pt-[1px] text-[12px] tabular-nums text-muted">
              {event.allDay ? '—' : format.time(event.start)}
            </span>
            <span
              aria-hidden="true"
              className="mt-[5px] h-[13px] w-[2px] shrink-0 rounded-full"
              style={{ background: sourceColor(definitions, event.sourceId) }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-text">{event.title}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                <AvailabilityDot value={displayAvailability(event)} />
                <span className="truncate">{event.venue.name}</span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
