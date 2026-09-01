'use client';

import Link from 'next/link';
import type { ViewMode } from '@/lib/calendar';
import { DETAIL_KEY, SIDEBAR_KEY, useKeyLabel } from '@/lib/keyboard';
import { useSettings } from '@/lib/settings/context';
import { CityPicker } from './CityPicker';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Keyboard,
  PanelLeft,
  PanelRight,
  Refresh,
  Settings,
} from './icons';

interface Props {
  view: ViewMode;
  anchor: string;
  loading: boolean;
  cityId: string;
  onCityChange: (id: string) => void;
  onViewChange: (view: ViewMode) => void;
  onStep: (direction: -1 | 1) => void;
  /** Am Rand des erhobenen Zeitraums gibt es nichts mehr zu blättern. */
  canStepBack: boolean;
  canStepForward: boolean;
  onToday: () => void;
  onRefresh: () => void;
  onOpenFilters: () => void;
  activeFilterCount: number;
  sidebarCollapsed: boolean;
  detailCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleDetail: () => void;
  onOpenShortcuts: () => void;
}

export function Toolbar({
  view,
  anchor,
  loading,
  cityId,
  onCityChange,
  onViewChange,
  onStep,
  canStepBack,
  canStepForward,
  onToday,
  onRefresh,
  onOpenFilters,
  activeFilterCount,
  sidebarCollapsed,
  detailCollapsed,
  onToggleSidebar,
  onToggleDetail,
  onOpenShortcuts,
}: Props) {
  const { format, t } = useSettings();
  // Auf QWERTZ heissen die Spaltenkürzel „Ü“ und „+“ statt „[“ und „]“.
  const sidebarKey = useKeyLabel(SIDEBAR_KEY);
  const detailKey = useKeyLabel(DETAIL_KEY);
  const title = format.rangeLabel(view, anchor);
  const mobileTitle = view === 'month' ? format.monthYearShort(anchor) : title;

  const views: { id: ViewMode; label: string; short: string }[] = [
    { id: 'day', label: t('day'), short: t('dayShort') },
    { id: 'week', label: t('week'), short: t('weekShort') },
    { id: 'month', label: t('month'), short: t('monthShort') },
  ];

  const iconButton =
    'grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-muted hover:bg-[var(--canvas)] hover:text-text';
  const stepButton = `${iconButton} disabled:pointer-events-none disabled:opacity-30`;

  return (
    <header className="flex h-12 shrink-0 items-center gap-1.5 bg-[var(--chrome)] px-2 hairline-b sm:px-3">
      <button
        type="button"
        onClick={onOpenFilters}
        className={`relative ${iconButton} lg:hidden`}
        aria-label={t('openFilters')}
      >
        <Filter />
        {activeFilterCount > 0 && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
        )}
      </button>

      <button
        type="button"
        onClick={onToggleSidebar}
        title={`${sidebarCollapsed ? t('expand') : t('collapse')} (${sidebarKey})`}
        aria-label={sidebarCollapsed ? t('expand') : t('collapse')}
        aria-pressed={!sidebarCollapsed}
        className={`hidden ${iconButton} lg:grid`}
      >
        <PanelLeft className={`h-4 w-4 ${sidebarCollapsed ? 'opacity-50' : ''}`} />
      </button>

      <span className="ml-1 hidden text-[13px] font-semibold tracking-[-0.01em] lg:inline">
        {t('appName')}
      </span>
      <CityPicker cityId={cityId} onChange={onCityChange} />

      <div className="mx-auto flex min-w-0 items-center gap-0.5 lg:mx-0 lg:ml-3">
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={!canStepBack}
          className={stepButton}
          title={`${t('previous')} (←)`}
          aria-label={t('previous')}
        >
          <ChevronLeft />
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={!canStepForward}
          className={stepButton}
          title={`${t('next')} (→)`}
          aria-label={t('next')}
        >
          <ChevronRight />
        </button>
        {/* Auf schmalen Geräten ersetzt der Titel den "Heute"-Knopf. */}
        <h1 className="ml-1.5 min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em]">
          <button
            type="button"
            onClick={onToday}
            title={`${t('today')} (T)`}
            className="truncate rounded-[var(--radius-sm)] px-1 py-0.5 hover:bg-[var(--canvas)]"
          >
            <span className="sm:hidden">{mobileTitle}</span>
            <span className="hidden sm:inline">{title}</span>
          </button>
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onRefresh}
          title={`${t('reload')} (R)`}
          aria-label={t('reload')}
          className={`hidden ${iconButton} sm:grid`}
        >
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="hidden h-7 rounded-[var(--radius-sm)] border border-line px-2.5 text-[12px]
                     text-muted hover:border-line-strong hover:text-text sm:block"
        >
          {t('today')}
        </button>

        <div
          role="tablist"
          aria-label={t('view')}
          className="flex h-7 items-center rounded-[var(--radius-sm)] border border-line p-[2px]"
        >
          {views.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={view === item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              title={`${item.label} (${item.short})`}
              className={`h-[22px] rounded-[3px] px-2 text-[12px] transition-colors ${
                view === item.id
                  ? 'bg-[var(--canvas)] text-text shadow-[0_0_0_1px_var(--line)]'
                  : 'text-muted hover:text-text'
              }`}
            >
              <span className="hidden sm:inline">{item.label}</span>
              <span className="sm:hidden">{item.short}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onToggleDetail}
          title={`${detailCollapsed ? t('expand') : t('collapse')} (${detailKey})`}
          aria-label={detailCollapsed ? t('expand') : t('collapse')}
          aria-pressed={!detailCollapsed}
          className={`hidden ${iconButton} lg:grid`}
        >
          <PanelRight className={`h-4 w-4 ${detailCollapsed ? 'opacity-50' : ''}`} />
        </button>

        <button
          type="button"
          onClick={onOpenShortcuts}
          title={`${t('shortcuts')} (?)`}
          aria-label={t('shortcuts')}
          className={`hidden ${iconButton} lg:grid`}
        >
          <Keyboard />
        </button>

        <Link href="/settings" aria-label={t('settings')} title={t('settings')} className={iconButton}>
          <Settings />
        </Link>
      </div>
    </header>
  );
}
