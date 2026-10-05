'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { EventGroup } from '@/lib/events/groups';
import type { SourceDefinition, SourceResult } from '@/lib/events/types';
import { useSettings } from '@/lib/settings/context';
import { TIMES_OF_DAY, type TimeOfDay } from '@/lib/events/filter';
import type { MessageKey } from '@/lib/i18n';
import { Bookmark, Euro, Ticket } from './icons';
import { SearchField } from './SearchField';
import { SourceGroups } from './SourceGroups';

interface Props {
  definitions: SourceDefinition[];
  status: SourceResult[];
  /** Gewählte Quellen; leer = alle. */
  selectedSources: ReadonlySet<string>;
  onToggleSourceGroup: (group: EventGroup) => void;
  onToggleSource: (id: string) => void;
  onClearSources: () => void;
  /** Arten, die bei den gewählten Quellen vorkommen, die häufigsten zuerst. */
  categories: { name: string; count: number }[];
  /** Gewählte Arten; leer = alle. */
  selectedCategories: ReadonlySet<string>;
  onToggleCategory: (name: string) => void;
  onClearCategories: () => void;
  availableOnly: boolean;
  onAvailableOnlyChange: (next: boolean) => void;
  freeOnly: boolean;
  onFreeOnlyChange: (next: boolean) => void;
  savedOnly: boolean;
  onSavedOnlyChange: (next: boolean) => void;
  /** Gemerkte Termine im geladenen Zeitraum; ohne sie fehlt der Schalter. */
  savedCount: number;
  /** Gewählte Tageszeiten; leer = alle. */
  timesOfDay: TimeOfDay[];
  onToggleTimeOfDay: (time: TimeOfDay) => void;
  query: string;
  onQueryChange: (next: string) => void;
}

/**
 * Filterspalte: Suche, Schnellfilter, Tageszeit, Veranstaltungsart und
 * Quellen. Überall gilt dasselbe: nichts gewählt heisst alles, jeder Klick
 * wählt aus, mehrere zusammen gehen.
 */
export function Sidebar({
  definitions,
  status,
  selectedSources,
  onToggleSourceGroup,
  onToggleSource,
  onClearSources,
  categories,
  selectedCategories,
  onToggleCategory,
  onClearCategories,
  availableOnly,
  onAvailableOnlyChange,
  freeOnly,
  onFreeOnlyChange,
  savedOnly,
  onSavedOnlyChange,
  savedCount,
  timesOfDay,
  onToggleTimeOfDay,
  query,
  onQueryChange,
}: Props) {
  const { t, term, format, settings } = useSettings();
  const [allCategories, setAllCategories] = useState(false);

  // Die häufigsten Arten, dazu jede gewählte – eine Wahl versteckt sich nicht.
  const visibleCategories = allCategories
    ? categories
    : categories.filter((category, index) => index < CATEGORY_PREVIEW || selectedCategories.has(category.name));
  const sourcesChosen = definitions.some((d) => selectedSources.has(d.id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto scroll-quiet px-4 py-4 lg:gap-5 lg:pr-2">
      {/* Rechts nur 8 px: die Kalenderfläche hält selbst 8 px Abstand – zusammen
          so viel wie links am Fensterrand. */}
      {/* Auf schmalen Geräten steht die Suche über dem Kalender, nicht hier. */}
      <SearchField query={query} onQueryChange={onQueryChange} className="hidden lg:block" />

      {/* Schnellfilter direkt unter der Suche – sie wirken zusammen: „Eintritt
          frei“ und „Karten buchbar“ heisst kostenlos, aber mit Platzkarte. */}
      <div className="flex flex-wrap gap-1.5 lg:-mt-2">
        <FilterChip pressed={availableOnly} onChange={onAvailableOnlyChange} icon={<Ticket className="h-3.5 w-3.5 shrink-0" />}>
          {t('onlyAvailable')}
        </FilterChip>
        <FilterChip
          pressed={freeOnly}
          onChange={onFreeOnlyChange}
          icon={<Euro className="h-3.5 w-3.5 shrink-0" />}
          title={t('onlyFreeTitle')}
        >
          {t('onlyFree')}
        </FilterChip>
        {(savedCount > 0 || savedOnly) && (
          <FilterChip
            pressed={savedOnly}
            onChange={onSavedOnlyChange}
            icon={<Bookmark filled={savedOnly} className="h-3.5 w-3.5 shrink-0" />}
            title={t('onlySavedTitle')}
          >
            {t('onlySaved')}
            <span className="ml-1.5 tabular-nums text-[10px] opacity-65">{savedCount}</span>
          </FilterChip>
        )}
      </div>

      <section>
        <SectionHeading>{t('timeOfDay')}</SectionHeading>
        {/* Mehrfachauswahl: „Abends“ und „Nachts“ zusammen ist der Ausgehabend. */}
        <div className="flex flex-wrap gap-1.5 lg:gap-1">
          {TIMES_OF_DAY.map((time, index) => {
            const next = TIMES_OF_DAY[(index + 1) % TIMES_OF_DAY.length];
            return (
              <FilterChip
                key={time}
                pressed={timesOfDay.includes(time)}
                onChange={() => onToggleTimeOfDay(time)}
                title={t('timeRange', {
                  from: format.hourLabel(settings.timeOfDayStarts[time]),
                  to: format.hourLabel(settings.timeOfDayStarts[next]),
                })}
              >
                {t(TIME_LABELS[time])}
              </FilterChip>
            );
          })}
        </div>
      </section>

      {categories.length > 1 && (
        <section>
          <SectionHeading onClear={selectedCategories.size > 0 ? onClearCategories : undefined}>
            {t('categories')}
          </SectionHeading>
          {/* Die häufigsten stehen da, der Rest auf Nachfrage. */}
          <div className="flex flex-wrap gap-1.5 lg:gap-1">
            {visibleCategories.map((category) => (
              <FilterChip
                key={category.name}
                pressed={selectedCategories.has(category.name)}
                onChange={() => onToggleCategory(category.name)}
              >
                {category.name ? term(category.name) : t('noCategory')}
              </FilterChip>
            ))}
            {categories.length > CATEGORY_PREVIEW && (
              <button
                type="button"
                aria-expanded={allCategories}
                onClick={() => setAllCategories((open) => !open)}
                className="rounded-full px-2 py-1.5 text-[13px] text-faint hover:text-muted lg:py-[3px] lg:text-[12px]"
              >
                {allCategories ? t('fewer') : t('more', { count: categories.length - visibleCategories.length })}
              </button>
            )}
          </div>
        </section>
      )}

      <section>
        <SectionHeading onClear={sourcesChosen ? onClearSources : undefined}>{t('sources')}</SectionHeading>
        <SourceGroups
          definitions={definitions}
          status={status}
          selected={selectedSources}
          onToggleGroup={onToggleSourceGroup}
          onToggleSource={onToggleSource}
        />
      </section>
      </div>

      <Link
        href="/settings"
        className="shrink-0 px-4 py-3 text-[12px] text-faint hairline-t hover:text-muted lg:hidden"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {t('settings')}
      </Link>
    </div>
  );
}

/** So viele Arten stehen da, bevor der Rest hinter „+ n weitere" wartet. */
const CATEGORY_PREVIEW = 6;

const TIME_LABELS: Record<TimeOfDay, MessageKey> = {
  day: 'timeDay',
  evening: 'timeEvening',
  night: 'timeNight',
};

/** Überschrift eines Abschnitts; mit Auswahl steht rechts „Alle“ zum Aufheben. */
function SectionHeading({ children, onClear }: { children: React.ReactNode; onClear?: () => void }) {
  const { t } = useSettings();
  return (
    <div className="mb-2 flex items-center px-0.5">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{children}</h2>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto rounded-[var(--radius-xs)] px-1 text-[11px] text-muted hover:text-text"
        >
          {t('showAll')}
        </button>
      )}
    </div>
  );
}

/** Ein-/Aus-Schalter als Pille, wie „Karten buchbar“. */
function FilterChip({
  pressed,
  onChange,
  icon,
  title,
  children,
}: {
  pressed: boolean;
  onChange: (next: boolean) => void;
  icon?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={() => onChange(!pressed)}
      className={`chip-hover flex min-w-0 items-center gap-1.5 rounded-full border
                  py-1.5 pr-3 text-[13px] lg:py-[3px] lg:pr-2.5 lg:text-[12px]
                  ${icon ? 'pl-2.5 lg:pl-2' : 'pl-3 lg:pl-2.5'} ${
                    pressed
                      ? 'border-transparent bg-[var(--accent-soft)] text-accent'
                      : 'border-line text-muted hover:border-line-strong hover:text-text'
                  }`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}
