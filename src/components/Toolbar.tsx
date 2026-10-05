'use client';

import type { ViewMode } from '@/lib/calendar';
import { DETAIL_KEY, SIDEBAR_KEY, useKeyLabel } from '@/lib/keyboard';
import { useSettings } from '@/lib/settings/context';
import Link from 'next/link';
import type { FeedFilter } from '@/lib/events/filter';
import { rememberReturn } from '@/lib/return-path';
import { useSavedEvents } from '@/lib/saved';
import { AppMenu } from './AppMenu';
import { CityPicker } from './CityPicker';
import { DayPicker } from './DayPicker';
import { Dropdown } from './Dropdown';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Filter,
  PanelLeft,
  PanelRight,
} from './icons';

interface Props {
  view: ViewMode;
  anchor: string;
  cityId: string;
  shareUrl: string;
  /** Die aktuellen Filter, fürs Kalender-Abo im Menü. */
  feedFilter: FeedFilter;
  onCityChange: (id: string) => void;
  onViewChange: (view: ViewMode) => void;
  onStep: (direction: -1 | 1) => void;
  /** Am Rand des erhobenen Zeitraums gibt es nichts mehr zu blättern. */
  canStepBack: boolean;
  canStepForward: boolean;
  onToday: () => void;
  /** Sprung auf einen bestimmten Tag. */
  onPickDay: (day: string) => void;
  selectedDay: string;
  /** Wählbarer Zeitraum der Tagesauswahl. */
  coverage: { from: string; to: string };
  /**
   * Ab `lg` steht die Datumsnavigation mittig über der Kalenderfläche, nicht
   * mittig im Fenster: dafür die Breiten der Spalten links und rechts.
   */
  leftInset: number;
  rightInset: number;
  /** Beim Ziehen einer Spalte folgt die Mitte sofort statt animiert. */
  animateInsets: boolean;
  onOpenFilters: () => void;
  activeFilterCount: number;
  sidebarCollapsed: boolean;
  detailCollapsed: boolean;
  /** In Tag und Woche gibt es ohne gewählten Termin nichts aufzuklappen. */
  canToggleDetail: boolean;
  onToggleSidebar: () => void;
  onToggleDetail: () => void;
  onOpenShortcuts: () => void;
}

export function Toolbar({
  view,
  anchor,
  cityId,
  shareUrl,
  feedFilter,
  onCityChange,
  onViewChange,
  onStep,
  canStepBack,
  canStepForward,
  onToday,
  onPickDay,
  selectedDay,
  coverage,
  leftInset,
  rightInset,
  animateInsets,
  onOpenFilters,
  activeFilterCount,
  sidebarCollapsed,
  detailCollapsed,
  canToggleDetail,
  onToggleSidebar,
  onToggleDetail,
  onOpenShortcuts,
}: Props) {
  const { format, t } = useSettings();
  const savedCount = useSavedEvents().ids.size;
  // Auf QWERTZ heissen die Spaltenkürzel „Ü“ und „+“ statt „[“ und „]“.
  const sidebarKey = useKeyLabel(SIDEBAR_KEY);
  const detailKey = useKeyLabel(DETAIL_KEY);
  const title = format.rangeLabel(view, anchor);
  // Auf schmalen Geräten steht neben dem Titel kaum Platz – dort die kurze
  // Fassung ("Mo., 7. Sept." statt "Montag, 7. September 2026").
  const mobileTitle = format.rangeLabelShort(view, anchor);

  const views: { id: ViewMode; label: string; short: string; wide?: boolean }[] = [
    { id: 'day', label: t('day'), short: t('dayShort') },
    { id: 'week', label: t('week'), short: t('weekShort') },
    { id: 'month', label: t('month'), short: t('monthShort') },
    // Die Karte braucht Platz für Pins, Ortskarte und die Spalten daneben –
    // auf schmalen Geräten steht sie deshalb (noch) nicht zur Wahl.
    { id: 'map', label: t('map'), short: t('mapShort'), wide: true },
  ];
  const currentView = views.find((item) => item.id === view) ?? views[0];

  // Ab lg stehen die Pfeile links und rechts vom Titel. Damit sie beim
  // Blättern nicht unter dem Zeiger wegrutschen, hat der Titel je Ansicht eine
  // feste Breite, die das längste Datum fasst.
  const titleWidth: Record<ViewMode, string> = {
    day: 'lg:w-[224px]',
    week: 'lg:w-[224px]',
    month: 'lg:w-[132px]',
    map: 'lg:w-[224px]',
  };

  // Auf schmalen Geräten sind die Knöpfe fingergerecht (36 px); ab `lg`
  // zeigt ein Zeiger auf sie und sie dürfen wieder klein sein.
  const iconButton =
    'grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] text-muted lg:h-7 lg:w-7 ' +
    'hover:bg-[var(--canvas)] hover:text-text';
  const stepButton = `${iconButton} disabled:pointer-events-none disabled:opacity-30`;
  // Die Pfeile stehen zu zweit nebeneinander und dürfen etwas schmaler sein.
  const arrowButton = `${stepButton} w-8 lg:w-7`;

  return (
    <header
      className="relative flex h-14 shrink-0 items-center gap-1 bg-[var(--chrome)] px-2 hairline-b lg:border-b-0
                 lg:h-12 lg:gap-1.5 lg:px-3"
    >
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

      {/* Bewusst ein einfacher Link statt `next/link`: der Name führt auf die
          nackte Startseite und lädt die Seite dabei wirklich neu – ohne Stadt,
          Ansicht und Datum aus der Adresse. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- der Neuladen-Effekt ist hier der Zweck */}
      <a
        href="/"
        title={t('appHomeTitle')}
        className="ml-1 hidden rounded-[var(--radius-sm)] px-1 py-0.5 text-[13px] font-semibold
                   tracking-[-0.01em] hover:bg-[var(--canvas)] lg:inline"
      >
        {t('appName')}
      </a>
      <CityPicker cityId={cityId} onChange={onCityChange} />

      {/* Ab lg mittig über der Kalenderfläche: die Mitte zwischen den Spalten,
          nicht die des Fensters. Auf schmalen Geräten ist `left` wirkungslos. */}
      <div
        className={`flex min-w-0 flex-1 items-center gap-0.5 lg:absolute lg:top-1/2 lg:-translate-x-1/2
                    lg:-translate-y-1/2 lg:flex-none
                    ${animateInsets ? 'lg:transition-[left] lg:duration-200 lg:ease-[cubic-bezier(0.32,0.72,0,1)]' : ''}`}
        style={{ left: `calc(50% + ${(leftInset - rightInset) / 2}px)` }}
      >
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={!canStepBack}
          className={arrowButton}
          title={`${t('previous')} (←)`}
          aria-label={t('previous')}
        >
          <ChevronLeft />
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={!canStepForward}
          className={`${arrowButton} lg:order-last`}
          title={`${t('next')} (→)`}
          aria-label={t('next')}
        >
          <ChevronRight />
        </button>
        {/* Auf schmalen Geräten ersetzt der Titel den "Heute"-Knopf. */}
        <h1
          className={`ml-0.5 min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em]
                      lg:mx-1 lg:text-center lg:text-[14px] ${titleWidth[view]}`}
        >
          <button
            type="button"
            onClick={onToday}
            title={`${t('today')} (T)`}
            className="block max-w-full truncate rounded-[var(--radius-sm)] px-1 py-1
                       hover:bg-[var(--canvas)] lg:mx-auto lg:py-0.5"
          >
            <span className="lg:hidden">{mobileTitle}</span>
            <span className="hidden lg:inline">{title}</span>
          </button>
        </h1>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 lg:gap-1.5">
        {/* Auf schmalen Geräten führt stattdessen der Titel nach heute. */}
        <DayPicker
          className="hidden md:block"
          selectedDay={selectedDay}
          coverage={coverage}
          onPick={onPickDay}
        />

        <Dropdown
          label={t('view')}
          value={view}
          buttonLabel={
            <>
              <span className="lg:hidden">{currentView.short}</span>
              <span className="hidden lg:inline">{currentView.label}</span>
            </>
          }
          options={views.map((item) => ({
            value: item.id,
            label: item.label,
            title: `${item.label} (${item.short})`,
            wide: item.wide,
          }))}
          onChange={onViewChange}
        />

        <button
          type="button"
          onClick={onToggleDetail}
          disabled={!canToggleDetail}
          title={`${detailCollapsed ? t('expand') : t('collapse')} (${detailKey})`}
          aria-label={detailCollapsed ? t('expand') : t('collapse')}
          aria-pressed={!detailCollapsed}
          className={`hidden ${stepButton} lg:grid`}
        >
          <PanelRight className={`h-4 w-4 ${detailCollapsed ? 'opacity-50' : ''}`} />
        </button>

        {/* Die Merkliste – mit Zahl, sobald etwas darauf steht. */}
        <Link
          href="/merkliste"
          onClick={rememberReturn}
          aria-label={t('savedOpen')}
          title={t('savedOpen')}
          className={`relative ${iconButton}`}
        >
          <Bookmark filled={savedCount > 0} className={`h-4 w-4 ${savedCount > 0 ? 'text-accent' : ''}`} />
          {savedCount > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full
                         bg-accent px-1 text-[10px] font-medium tabular-nums leading-none text-white
                         lg:-right-1 lg:-top-1"
            >
              {savedCount}
            </span>
          )}
        </Link>

        <AppMenu
          cityId={cityId}
          shareUrl={shareUrl}
          feedFilter={feedFilter}
          onOpenShortcuts={onOpenShortcuts}
          className={iconButton}
        />
      </div>
    </header>
  );
}
