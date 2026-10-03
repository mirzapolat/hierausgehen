'use client';

import { useMemo, useState } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { daysBetween } from '@/lib/calendar';
import { byDay, splitSpans } from '@/lib/events/display';
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
  /** Weitere Termine derselben Produktion wie der gewählte. */
  relatedIds?: ReadonlySet<string>;
}

/** So viele mehrtägige Termine stehen vorn, bevor der Rest eingeklappt bleibt. */
const RUNNING_PREVIEW = 2;

const heading = `sticky top-0 z-10 bg-[var(--chrome)]/95 px-4 py-1.5 text-[11px] font-medium
                 uppercase tracking-[0.05em] text-muted backdrop-blur hairline-b`;

/**
 * Chronologische Liste mit klebenden Tagesüberschriften – die Mobilansicht.
 *
 * Mehrtägiges steht einmal vorn unter eigener Überschrift, mit „bis …"
 * statt Uhrzeit – sonst stünde eine Ausstellung an jedem Tag der Woche.
 */
export function MobileAgenda({
  from,
  to,
  events,
  definitions,
  selectedEventId,
  onSelectEvent,
  hideEmptyDays = true,
  relatedIds,
}: Props) {
  const { format, t } = useSettings();
  const { single, spans } = useMemo(() => splitSpans(events, format), [events, format]);
  const grouped = useMemo(() => byDay(single, format), [single, format]);
  const running = useMemo(
    () =>
      spans
        .filter((span) => span.from <= to && span.to >= from)
        .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
        .map((span) => span.event),
    [spans, from, to],
  );
  const days = useMemo(() => daysBetween(from, to), [from, to]);
  const currentDay = format.today();
  const [showAllRunning, setShowAllRunning] = useState(false);

  const visible = hideEmptyDays ? days.filter((d) => (grouped.get(d)?.length ?? 0) > 0) : days;

  if (visible.length === 0 && running.length === 0) {
    return <p className="px-4 py-10 text-center text-[13px] text-faint">{t('noEventsRange')}</p>;
  }

  return (
    <div className="flex flex-col">
      {running.length > 0 && (
        <section>
          <h3 className={heading}>{t('multiDay')}</h3>
          <AgendaList
            events={showAllRunning ? running : running.slice(0, RUNNING_PREVIEW)}
            definitions={definitions}
            selectedId={selectedEventId}
            onSelect={onSelectEvent}
            spanLabels
            relatedIds={relatedIds}
          />
          {running.length > RUNNING_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAllRunning((shown) => !shown)}
              aria-expanded={showAllRunning}
              className="w-full px-4 py-2 text-left text-[12px] text-muted hairline-b hover:text-text"
            >
              {showAllRunning ? t('collapse') : t('more', { count: running.length - RUNNING_PREVIEW })}
            </button>
          )}
        </section>
      )}
      {visible.map((day) => (
        <section key={day}>
          <h3 className={heading}>
            {day === currentDay ? `${t('today')} · ` : ''}
            {format.dayMedium(day)}
          </h3>
          <AgendaList
            events={grouped.get(day) ?? []}
            definitions={definitions}
            selectedId={selectedEventId}
            onSelect={onSelectEvent}
            relatedIds={relatedIds}
          />
        </section>
      ))}
    </div>
  );
}
