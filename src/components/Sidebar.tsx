'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SourceDefinition, SourceResult } from '@/lib/events/types';
import { useSettings } from '@/lib/settings/context';
import { groupColor, type EventGroup } from '@/lib/events/groups';
import { Checkbox } from './Checkbox';
import { SourceIcon } from './SourceIcon';
import { ChevronDown, Close, MoreHorizontal, Ticket, Warning } from './icons';
import { SearchField } from './SearchField';

interface Props {
  definitions: SourceDefinition[];
  status: SourceResult[];
  enabled: Set<string>;
  onToggleSource: (id: string) => void;
  onToggleGroup: (ids: string[], next: boolean) => void;
  /** Leer = kein Quellenfokus. Sonst sind ausschliesslich diese Quellen sichtbar. */
  solo: Set<string>;
  onSolo: (ids: string[]) => void;
  /** Gattungen, die im geladenen Zeitraum tatsächlich vorkommen, mit Anzahl. */
  categories: { name: string; count: number }[];
  /** Tatsächlich sichtbare Arten – bei aktivem Fokus nur die fokussierte. */
  enabledCategories: Set<string>;
  onToggleCategory: (name: string) => void;
  /** Leer = kein Kategorienfokus. Sonst sind ausschliesslich diese Arten sichtbar. */
  categorySolo: Set<string>;
  onCategorySolo: (name: string) => void;
  onShowAllCategories: () => void;
  availableOnly: boolean;
  onAvailableOnlyChange: (next: boolean) => void;
  query: string;
  onQueryChange: (next: string) => void;
}

/**
 * Filterspalte: Quellen in Ordnern, dazu Suche und ein Schnellfilter für
 * verfügbare Karten. Ein Ordner lässt sich als Ganzes an- und abwählen.
 */
export function Sidebar({
  definitions,
  status,
  enabled,
  onToggleSource,
  onToggleGroup,
  solo,
  onSolo,
  categories,
  enabledCategories,
  onToggleCategory,
  categorySolo,
  onCategorySolo,
  onShowAllCategories,
  availableOnly,
  onAvailableOnlyChange,
  query,
  onQueryChange,
}: Props) {
  const { t, format } = useSettings();
  const groups = useMemo(() => groupSources(definitions), [definitions]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const statusById = useMemo(() => new Map(status.map((s) => [s.sourceId, s])), [status]);

  return (
    <div className="flex h-full flex-col">
      {/* Nur die Filter scrollen; Stand und Impressum bleiben unten sichtbar. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto scroll-quiet px-4 py-4">
      {/* Auf schmalen Geräten steht die Suche über dem Kalender, nicht hier. */}
      <SearchField query={query} onQueryChange={onQueryChange} className="hidden lg:block" />

      <button
        type="button"
        aria-pressed={availableOnly}
        onClick={() => onAvailableOnlyChange(!availableOnly)}
        className={`flex items-center gap-1.5 self-start lg:-mt-2 rounded-full border py-[3px] pl-2 pr-2.5
                    text-[12px] transition-colors ${
                      availableOnly
                        ? 'border-transparent bg-[var(--accent-soft)] text-accent'
                        : 'border-line text-faint hover:border-line-strong hover:text-muted'
                    }`}
      >
        <Ticket className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t('onlyAvailable')}</span>
      </button>

      <section>
        <div className="mb-2 flex items-center gap-2 px-0.5">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
            {t('sources')}
          </h2>
          {solo.size > 0 && (
            <button
              type="button"
              onClick={() => onSolo([])}
              className="ml-auto flex items-center gap-1 rounded-[var(--radius-xs)] bg-[var(--accent-soft)]
                         px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-[0.05em] text-accent"
              title={t('soloOff')}
            >
              {t('soloActive')}
              <Close className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          {groups.map((group) => {
            const ids = group.sources.map((s) => s.id);
            const active = ids.filter((id) => enabled.has(id)).length;
            const groupState = active === 0 ? 'off' : active === ids.length ? 'on' : 'mixed';
            const isCollapsed = collapsed.has(group.name);
            const groupFocused = isSolo(solo, ids);

            return (
              <div key={group.name}>
                <div className="group relative flex items-center gap-2 pl-1">
                  <Checkbox
                    state={groupState}
                    color={groupColor(group.name)}
                    label={group.name}
                    onChange={() => onToggleGroup(ids, groupState !== 'on')}
                  />
                  {/* Der Name fokussiert den Ordner – wie bei einer einzelnen
                      Quelle. Das Auf- und Zuklappen sitzt auf dem Pfeil. */}
                  <button
                    type="button"
                    aria-pressed={groupFocused}
                    title={groupFocused ? t('soloOff') : t('soloOn')}
                    onClick={() => onSolo(ids)}
                    className={`min-w-0 flex-1 truncate rounded-[var(--radius-xs)] py-0.5 text-left
                                text-[12px] font-medium ${
                                  groupFocused ? 'text-accent' : 'text-muted hover:text-text'
                                }`}
                  >
                    {group.name}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.name)) next.delete(group.name);
                        else next.add(group.name);
                        return next;
                      })
                    }
                    aria-expanded={!isCollapsed}
                    aria-label={isCollapsed ? t('expand') : t('collapse')}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-xs)]
                               text-faint hover:bg-[var(--canvas)] hover:text-muted"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                    />
                  </button>
                </div>

                {!isCollapsed && (
                  <ul className="mt-0.5 flex flex-col">
                    {group.sources.map((source) => {
                      const info = statusById.get(source.id);
                      const isEnabled = enabled.has(source.id);
                      const ailing = info?.status === 'stale' || info?.status === 'error';
                      const sourceFocused = isSolo(solo, [source.id]);
                      return (
                        <li key={source.id}>
                          <div
                            className={`group relative flex items-center gap-2
                                       rounded-[var(--radius-sm)] py-1.5 pl-[22px] pr-1.5
                                       ${sourceFocused ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--canvas)]'}`}
                          >
                            <Checkbox
                              state={isEnabled ? 'on' : 'off'}
                              color={groupColor(source.group)}
                              label={source.name}
                              onChange={() => onToggleSource(source.id)}
                            />
                            <button
                              type="button"
                              aria-pressed={sourceFocused}
                              title={sourceFocused ? t('soloOff') : t('soloOn')}
                              onClick={() => onSolo([source.id])}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-xs)]
                                         text-left focus-visible:outline-offset-2"
                            >
                              <SourceIcon source={source} />
                              <span
                                className={`flex-1 truncate text-[13px] ${
                                  sourceFocused ? 'font-medium text-accent' : isEnabled ? 'text-text' : 'text-faint'
                                }`}
                              >
                                {source.name}
                              </span>
                            </button>
                            {/* Eine laufende Auffrischung ist kein Problem –
                                gewarnt wird nur bei echten Ausfällen. */}
                            {ailing && (
                              <span
                                title={
                                  info.status === 'stale'
                                    ? t('asOf', { time: format.stamp(info.fetchedAt) })
                                    : (info.error ?? '')
                                }
                              >
                                <Warning className="h-3.5 w-3.5 text-[var(--danger)]" />
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {categories.length > 1 && (
        <section>
          <h2 className="mb-2 px-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
            {t('categories')}
          </h2>
          {/* Pillen statt Kästchen: kompakter und beliebig kombinierbar. */}
          <div className="flex flex-wrap gap-1">
            {categories.map((category) => (
              <CategoryPill
                key={category.name}
                name={category.name}
                count={category.count}
                active={enabledCategories.has(category.name)}
                solo={categorySolo.has(category.name)}
                onToggle={() => onToggleCategory(category.name)}
                onSolo={() => onCategorySolo(category.name)}
                onShowAll={onShowAllCategories}
              />
            ))}
          </div>
        </section>
      )}

      </div>

      <SourceFootnote />
    </div>
  );
}

/**
 * Eine Veranstaltungsart als Pille. Klick schaltet sie an oder aus; über das
 * Drei-Punkte-Menü lässt sie sich für einen Moment allein anzeigen.
 */
function CategoryPill({
  name,
  count,
  active,
  solo,
  onToggle,
  onSolo,
  onShowAll,
}: {
  name: string;
  count: number;
  active: boolean;
  solo: boolean;
  onToggle: () => void;
  onSolo: () => void;
  onShowAll: () => void;
}) {
  const { t } = useSettings();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  /** Feste Position, damit das Menü nicht am Scrollrand der Sidebar abschneidet. */
  const [menu, setMenu] = useState<{ left: number; top: number }>();
  const open = menu !== undefined;

  useEffect(() => {
    if (!open) return;
    const close = () => setMenu(undefined);
    const onPointerDown = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const openMenu = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = MENU_WIDTH;
    setMenu({
      left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
      top: rect.bottom + 4,
    });
  };

  const tone = solo
    ? 'border-transparent bg-accent text-white'
    : active
      ? 'border-transparent bg-[var(--accent-soft)] text-accent'
      : 'border-line text-faint hover:border-line-strong hover:text-muted';

  return (
    <div ref={container} className="group relative">
      <button
        type="button"
        aria-pressed={active}
        onClick={onToggle}
        className={`flex items-center gap-1.5 rounded-full border py-[3px] pl-2 pr-2 text-[12px]
                    transition-colors ${tone}`}
      >
        <span className="truncate">{name || t('noCategory')}</span>
        <span className="tabular-nums text-[10px] opacity-65">{count}</span>
      </button>

      <button
        type="button"
        aria-label={t('moreOptions')}
        aria-haspopup="menu"
        ref={trigger}
        aria-expanded={open}
        onClick={() => (open ? setMenu(undefined) : openMenu())}
        className={`absolute right-0 top-0 grid h-full w-6 place-items-center rounded-full
                    transition-opacity focus-visible:opacity-100
                    [@media(hover:none)]:opacity-100
                    ${solo ? 'text-white' : 'text-muted'}
                    ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{
          background: solo
            ? 'linear-gradient(to right, transparent, var(--accent) 40%)'
            : active
              ? 'linear-gradient(to right, transparent, var(--accent-soft) 40%)'
              : 'linear-gradient(to right, transparent, var(--chrome) 40%)',
        }}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {menu && (
        <div
          role="menu"
          className="fixed z-50 overflow-hidden rounded-[var(--radius-md)] border border-line
                     bg-[var(--raised)] py-1"
          style={{ left: menu.left, top: menu.top, width: MENU_WIDTH, boxShadow: 'var(--shadow-overlay)' }}
        >
          <MenuItem
            label={solo ? t('soloOff') : t('soloCategoryOn')}
            onClick={() => {
              onSolo();
              setMenu(undefined);
            }}
          />
          <MenuItem
            label={t('showAllCategories')}
            onClick={() => {
              onShowAll();
              setMenu(undefined);
            }}
          />
        </div>
      )}
    </div>
  );
}

const MENU_WIDTH = 168;

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full px-2.5 py-1.5 text-left text-[13px] text-text hover:bg-[var(--chrome)]"
    >
      {label}
    </button>
  );
}

/** Trifft die temporäre Quellen-Auswahl genau diese Quellen? */
function isSolo(solo: Set<string>, ids: string[]): boolean {
  return solo.size === ids.length && ids.every((id) => solo.has(id));
}

function SourceFootnote() {
  const { t, settings } = useSettings();

  return (
    <div className="shrink-0 bg-[var(--chrome)] px-4 py-3 hairline-t">
      <div className="flex items-center gap-3">
        <Link
          href="/status"
          className="text-[11px] text-faint underline-offset-2 hover:text-muted hover:underline"
        >
          {t('status')}
        </Link>
        <Link
          href="/impressum"
          className="text-[11px] text-faint underline-offset-2 hover:text-muted hover:underline"
        >
          {t('imprint')}
        </Link>
        {/* Kein <Link>: die CSV kommt von der API, sie ist keine Seite. */}
        <a
          href={`/api/events/export?city=${encodeURIComponent(settings.cityId)}`}
          download
          title={t('exportCsvTitle')}
          className="text-[11px] text-faint underline-offset-2 hover:text-muted hover:underline"
        >
          {t('exportCsv')}
        </a>
      </div>
    </div>
  );
}

function groupSources(definitions: SourceDefinition[]) {
  const groups = new Map<EventGroup, SourceDefinition[]>();
  for (const definition of definitions) {
    const list = groups.get(definition.group) ?? [];
    list.push(definition);
    groups.set(definition.group, list);
  }
  return [...groups.entries()]
    .map(([name, sources]) => ({
      name,
      sources: sources.sort((a, b) => a.name.localeCompare(b.name, 'de')),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
