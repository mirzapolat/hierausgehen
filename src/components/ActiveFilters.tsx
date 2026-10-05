'use client';

import type { SourceDefinition } from '@/lib/events/types';
import { sourceName } from '@/lib/events/display';
import type { TimeOfDay } from '@/lib/events/filter';
import { GROUP_COLORS, groupColor, type EventGroup } from '@/lib/events/groups';
import { groupState } from '@/lib/events/source-selection';
import type { MessageKey } from '@/lib/i18n';
import { useSettings } from '@/lib/settings/context';
import type { useEventFilters } from '@/lib/useEventFilters';
import { Close } from './icons';

interface Props {
  filters: ReturnType<typeof useEventFilters>;
  definitions: SourceDefinition[];
  /** „23 Termine im Oktober" – was nach den Filtern im Bild bleibt. */
  summary: string;
}

interface Chip {
  key: string;
  label: string;
  remove: () => void;
  /** Farbe des Ordners – ein Punkt unterscheidet „Theater“ als Ordner von der Art. */
  color?: string;
  /** Nur ab `lg` – auf dem Telefon steht die Suche ohnehin darüber. */
  wideOnly?: boolean;
}

const TIME_LABELS: Record<TimeOfDay, MessageKey> = {
  day: 'timeDay',
  evening: 'timeEvening',
  night: 'timeNight',
};

/**
 * Was gerade gefiltert ist, in einer Zeile über dem Kalender – jeder Filter
 * einzeln abwählbar, alle zusammen über „Zurücksetzen". Ohne aktive Filter
 * steht hier nichts.
 *
 * Die Filterspalte kann zugeklappt sein, auf dem Telefon ist sie ein Overlay:
 * ohne diese Zeile sähe man nicht, warum etwas fehlt.
 */
export function ActiveFilters({ filters, definitions, summary }: Props) {
  const { t, term } = useSettings();
  if (filters.activeFilterCount === 0) return null;

  const chips: Chip[] = [];

  if (filters.query) {
    chips.push({ key: 'query', label: `„${filters.query}"`, remove: () => filters.setQuery(''), wideOnly: true });
  }

  // Je Ordner ein Chip: ganz gewählt mit seinem Namen, eingegrenzt mit den Häusern.
  if (filters.sourcesFiltered) {
    for (const group of Object.keys(GROUP_COLORS) as EventGroup[]) {
      const ids = definitions.filter((d) => d.group === group).map((d) => d.id);
      const state = groupState(filters.selectedSources, ids);
      if (state === 'none') continue;
      const chosen = ids.filter((id) => filters.selectedSources.has(id));
      chips.push({
        key: `group-${group}`,
        label: state === 'all' ? term(group) : chosen.map((id) => sourceName(definitions, id)).join(', '),
        color: groupColor(group),
        remove: () => filters.clearSources(chosen),
      });
    }
  }

  for (const name of filters.selectedCategories) {
    chips.push({
      key: `category-${name}`,
      label: name ? term(name) : t('noCategory'),
      remove: () => filters.toggleCategory(name),
    });
  }

  if (filters.timesOfDay.length > 0) {
    chips.push({
      key: 'time',
      label: filters.timesOfDay.map((time) => t(TIME_LABELS[time])).join(' + '),
      remove: filters.clearTimesOfDay,
    });
  }
  if (filters.availableOnly) {
    chips.push({ key: 'tickets', label: t('onlyAvailable'), remove: () => filters.setAvailableOnly(false) });
  }
  if (filters.freeOnly) chips.push({ key: 'free', label: t('onlyFree'), remove: () => filters.setFreeOnly(false) });
  if (filters.savedOnly) chips.push({ key: 'saved', label: t('onlySaved'), remove: () => filters.setSavedOnly(false) });

  return (
    <div
      role="region"
      aria-label={t('activeFilters')}
      className="flex shrink-0 items-center gap-2 px-3 py-2 hairline-b"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scroll-hidden">
        {chips.map((chip) => (
          <span
            key={chip.key}
            className={`${chip.wideOnly ? 'hidden lg:flex' : 'flex'} shrink-0 items-center rounded-full
                        bg-[var(--accent-soft)] py-[3px] pl-2.5 pr-1 text-[12px] text-accent`}
          >
            {chip.color && (
              <span aria-hidden="true" className="mr-1.5 h-2 w-2 shrink-0 rounded-[2px]" style={{ background: chip.color }} />
            )}
            <span className="max-w-[180px] truncate">{chip.label}</span>
            <button
              type="button"
              onClick={chip.remove}
              aria-label={t('removeFilter', { name: chip.label })}
              title={t('removeFilter', { name: chip.label })}
              className="ml-0.5 grid h-4 w-4 place-items-center rounded-full hover:bg-[var(--canvas)]"
            >
              <Close className="h-3 w-3" />
            </button>
          </span>
        ))}
        <span className="shrink-0 whitespace-nowrap pl-1 text-[12px] tabular-nums text-faint">{summary}</span>
      </div>
      <button
        type="button"
        onClick={filters.reset}
        className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-muted
                   hover:bg-[var(--chrome)] hover:text-text"
      >
        {t('resetFilters')}
      </button>
    </div>
  );
}
