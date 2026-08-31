'use client';

import { useMemo } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { daysBetween } from '@/lib/calendar';
import { byDay } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { AgendaList } from './AgendaList';

interface Props {
  from: string;
  to: string;
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  selectedEventId?: string;
  onSelectEvent: (event: CalendarEvent) => void;
  /** Tage ohne Termine ausblenden – auf kleinen Bildschirmen ruhiger. */
  hideEmptyDays?: boolean;
}

/** Chronologische Liste mit klebenden Tagesüberschriften – die Mobilansicht. */
export function MobileAgenda({
  from,
  to,
  events,
  definitions,
  selectedEventId,
  onSelectEvent,
  hideEmptyDays = true,
}: Props) {
  const { format, t } = useSettings();
  const grouped = useMemo(() => byDay(events, format), [events, format]);
  const days = useMemo(() => daysBetween(from, to), [from, to]);
  const currentDay = format.today();

  const visible = hideEmptyDays ? days.filter((d) => (grouped.get(d)?.length ?? 0) > 0) : days;

  if (visible.length === 0) {
    return <p className="px-4 py-10 text-center text-[13px] text-faint">{t('noEventsRange')}</p>;
  }

  return (
    <div className="flex flex-col">
      {visible.map((day) => (
        <section key={day}>
          <h3
            className="sticky top-0 z-10 bg-[var(--chrome)]/95 px-4 py-1.5 text-[11px] font-medium
                       uppercase tracking-[0.05em] text-muted backdrop-blur hairline-b"
          >
            {day === currentDay ? `${t('today')} · ` : ''}
            {format.dayMedium(day)}
          </h3>
          <AgendaList
            events={grouped.get(day) ?? []}
            definitions={definitions}
            selectedId={selectedEventId}
            onSelect={onSelectEvent}
          />
        </section>
      ))}
    </div>
  );
}
