'use client';

import { useMemo } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { groupMix, isPast, sourceColor } from '@/lib/events/display';
import { groupColor } from '@/lib/events/groups';
import { groupBySeries, pickForCell } from '@/lib/events/series';
import { useSeriesRuns } from '@/lib/series-context';
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
   * Solche Tage treten als Ganzes zurück – Fläche, Ziffer und Tönung –, damit
   * die Grenze des Monats ohne Hinsehen erkennbar ist.
   */
  outside?: boolean;
  /** Tönung statt Titel – für die Mobilansicht. */
  compact?: boolean;
  /** Monatsnamen neben der Ziffer zeigen (Monatsanfang im Endlos-Scroll). */
  showMonth?: boolean;
  maxEvents?: number;
  /** Termine am vollsten Tag ringsum – Massstab für die Tönung. */
  busiest?: number;
  /** Weitere Termine derselben Produktion wie der gewählte – sie werden hervorgehoben. */
  relatedIds?: ReadonlySet<string>;
}

/**
 * Eine Zelle des Monatsrasters – geteilt von fester und scrollender Ansicht.
 *
 * Mehrtägiges steht hier nicht: Ausstellungen und Festivals laufen über
 * Wochen und würden jede Zeile mit demselben Balken füllen. Sie stehen in der
 * Tagesübersicht daneben.
 */
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
  busiest = 0,
  relatedIds,
}: Props) {
  const { format, t } = useSettings();
  const runs = useSeriesRuns();
  const isPastDay = day < format.today();

  // Die Tönung (nur mobil): wie voll der Tag ist und woraus er besteht. Tage
  // aus dem Nachbarmonat bleiben leer – sie gehören nicht zu diesem Monat.
  const tint = useMemo(
    () => (compact && !outside ? dayTint(groupMix(events, definitions), busiest) : undefined),
    [compact, outside, events, definitions, busiest],
  );

  // Mehrere Vorstellungen eines Stücks am selben Tag sind eine Zeile; passt
  // nicht alles hinein, hat Seltenes Vorrang vor der nächsten Vorstellung.
  const { shown, hidden } = useMemo(
    () =>
      compact
        ? { shown: [], hidden: 0 }
        : pickForCell(
            groupBySeries(events),
            maxEvents,
            runs,
            (event) => event.id === selectedEventId || Boolean(relatedIds?.has(event.id)),
          ),
    [compact, events, maxEvents, runs, selectedEventId, relatedIds],
  );

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
      className={`relative flex min-h-0 cursor-pointer flex-col gap-[3px] overflow-hidden px-1.5 pt-1 ${compact ? 'justify-center pb-1' : 'pb-2.5'}
                  hairline-r hairline-b transition-colors
                  ${
                    selected
                      ? 'bg-[var(--accent-soft)]'
                      : outside
                        ? compact ? 'bg-[var(--canvas)]' : 'bg-[var(--sunken)]'
                        : 'hover:bg-[var(--chrome)]'
                  }`}
    >
      {/* Mobil: Tage aus dem Nachbarmonat schraffiert – erkennbar als
          „gehört nicht hierher“, ohne mit einer Tönung zu konkurrieren. */}
      {compact && outside && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, var(--line) 0 1px, transparent 1px 6px)',
          }}
        />
      )}

      {tint && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: tint, opacity: isPastDay ? 0.45 : 1 }}
        />
      )}

      <div className={`relative flex shrink-0 items-baseline gap-1 ${compact ? 'justify-center' : ''}`}>
        <span
          className={`grid place-items-center rounded-full px-1 tabular-nums
                      ${compact ? 'h-6 min-w-6 text-[15px]' : 'h-5 min-w-5 text-[13px] font-semibold'}
                      ${isToday ? 'bg-accent font-semibold text-white' : outside ? 'text-faint' : compact ? 'text-muted' : 'text-text'}`}
        >
          {format.dayNumber(day)}
        </span>
        {showMonth && (
          <span className="truncate text-[11px] font-medium text-text">
            {format.monthName(day)}
          </span>
        )}
      </div>

      {!compact && (
        <div className="flex min-h-0 flex-col gap-[2px] overflow-hidden">
          {shown.map((group) => {
            const event = group.find((candidate) => candidate.id === selectedEventId) ?? group[0];
            // Vergangenes und Ausverkauftes tritt zurück, verschwindet aber nicht.
            const dimmed = isPast(event) || event.availability === 'soldout';
            // Ausverkauftes tritt noch etwas weiter zurück – hingehen geht ohnehin nicht.
            const soldout = event.availability === 'soldout' && !isPast(event);
            const color = sourceColor(definitions, event.sourceId);
            const isSelected = group.some((candidate) => candidate.id === selectedEventId);
            // Weitere Termine derselben Produktion: in der Farbe der Quelle
            // unterlegt, solange der gewählte Termin offen ist.
            const related = !isSelected && group.some((candidate) => relatedIds?.has(candidate.id));
            const times = group.filter((g) => !g.allDay).map((g) => format.time(g.start));
            return (
              <button
                key={event.id}
                type="button"
                data-event-id={event.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEvent(event);
                }}
                title={`${times.length ? times.join(' · ') + ' ' : ''}${event.title} · ${event.venue.name}`}
                className={`flex items-center gap-1.5 rounded-[var(--radius-xs)] px-1 py-[1px] text-left ${soldout ? 'opacity-50 hover:opacity-100' : ''}
                            ${
                              isSelected
                                ? 'bg-[var(--canvas)] shadow-[0_0_0_1px_var(--line-strong)]'
                                : related
                                  ? ''
                                  : 'hover:bg-[var(--canvas)]'
                            }`}
                style={related ? { background: `color-mix(in srgb, ${color} 18%, var(--canvas))` } : undefined}
              >
                <span
                  aria-hidden="true"
                  className="h-[5px] w-[5px] shrink-0 rounded-full"
                  style={{ background: color, opacity: dimmed ? 0.35 : 1 }}
                />
                {!event.allDay && (
                  <span className={`shrink-0 text-[11px] tabular-nums ${dimmed ? 'opacity-60' : ''} text-faint`}>
                    {format.time(event.start)}
                  </span>
                )}
                <span
                  className={`truncate text-[12px] ${related ? 'font-medium' : ''} ${
                    dimmed ? 'text-faint' : 'text-muted'
                  }`}
                >
                  {event.title}
                </span>
                {group.length > 1 && (
                  <span className="shrink-0 text-[10px] tabular-nums text-faint">{group.length}×</span>
                )}
              </button>
            );
          })}
          {hidden > 0 && (
            <span className="px-1 text-[11px] text-faint">{t('more', { count: hidden })}</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Die Tönung eines Tages.
 *
 * Die ganze Zelle trägt die Töne der Ordner des Tages – je mehr los ist,
 * gemessen am vollsten Tag ringsum, desto satter.
 */
function dayTint(mix: ReturnType<typeof groupMix>, busiest: number): string | undefined {
  const total = mix.reduce((sum, share) => sum + share.count, 0);
  if (total === 0 || busiest === 0) return undefined;
  const level = 0.12 + 0.88 * Math.min(total / busiest, 1);
  // Ein ruhiger Tag ist ein Hauch, der vollste fast die Farbe selbst.
  const strength = Math.round(10 + 45 * level);

  // Die Fläche mischt alle Töne des Tages. Gewichtet mit der Wurzel der
  // Anzahl: zehn Theaterabende neben zwei Konzerten färben den Tag rötlich,
  // aber nicht rot – die Minderheit bleibt sichtbar. Pastell verträgt das
  // Mischen, ohne zu Braun zu werden.
  const tone = blend(mix.map((share) => ({ color: groupColor(share.group), weight: Math.sqrt(share.count) })));
  return `color-mix(in srgb, ${tone} ${strength}%, transparent)`;
}

/** Gewichtetes Mittel mehrerer Hex-Farben (`#rrggbb`), wieder als Hex. */
function blend(parts: { color: string; weight: number }[]): string {
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  const channel = (offset: number) =>
    Math.round(
      parts.reduce((sum, part) => sum + parseInt(part.color.slice(offset, offset + 2), 16) * part.weight, 0) / total,
    );
  return `#${[1, 3, 5].map((offset) => channel(offset).toString(16).padStart(2, '0')).join('')}`;
}
