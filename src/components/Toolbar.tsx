'use client';

import Link from 'next/link';
import { addDays, type ViewMode } from '@/lib/calendar';
import { DETAIL_KEY, SIDEBAR_KEY, useKeyLabel } from '@/lib/keyboard';
import { useSettings } from '@/lib/settings/context';
import { AppMenu } from './AppMenu';
import { CityPicker } from './CityPicker';
import { ShareButton } from './ShareButton';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Keyboard,
  PanelLeft,
  PanelRight,
  Settings,
} from './icons';

interface Props {
  view: ViewMode;
  anchor: string;
  cityId: string;
  shareUrl: string;
  onCityChange: (id: string) => void;
  onViewChange: (view: ViewMode) => void;
  onStep: (direction: -1 | 1) => void;
  /** Am Rand des erhobenen Zeitraums gibt es nichts mehr zu blättern. */
  canStepBack: boolean;
  canStepForward: boolean;
  onToday: () => void;
  /** Sprung auf heute (0), morgen (1) oder übermorgen (2). */
  onJumpDay: (offset: number) => void;
  /** Nur zur Anzeige: welcher der drei Tage gerade gewählt ist. */
  selectedDay: string;
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
  onCityChange,
  onViewChange,
  onStep,
  canStepBack,
  canStepForward,
  onToday,
  onJumpDay,
  selectedDay,
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
  // Auf QWERTZ heissen die Spaltenkürzel „Ü“ und „+“ statt „[“ und „]“.
  const sidebarKey = useKeyLabel(SIDEBAR_KEY);
  const detailKey = useKeyLabel(DETAIL_KEY);
  const title = format.rangeLabel(view, anchor);
  // Auf schmalen Geräten steht neben dem Titel kaum Platz – dort die kurze
  // Fassung ("Mo., 7. Sept." statt "Montag, 7. September 2026").
  const mobileTitle = format.rangeLabelShort(view, anchor);

  // Die drei Tage, nach denen am häufigsten gefragt wird. Auf schmalen
  // Geräten führt stattdessen der Titel nach heute – dort ist kein Platz.
  const jumps = [
    { offset: 0, label: t('today') },
    { offset: 1, label: t('tomorrow') },
    { offset: 2, label: t('dayAfterTomorrow') },
  ].map((jump) => ({ ...jump, day: addDays(format.today(), jump.offset) }));

  const views: { id: ViewMode; label: string; short: string; wide?: boolean }[] = [
    { id: 'day', label: t('day'), short: t('dayShort') },
    { id: 'week', label: t('week'), short: t('weekShort') },
    { id: 'month', label: t('month'), short: t('monthShort') },
    // Die Karte braucht Platz für Pins, Ortskarte und die Spalten daneben –
    // auf schmalen Geräten steht sie deshalb (noch) nicht zur Wahl.
    { id: 'map', label: t('map'), short: t('mapShort'), wide: true },
  ];

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
      className="flex h-14 shrink-0 items-center gap-1 bg-[var(--chrome)] px-2 hairline-b
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

      <div className="flex min-w-0 flex-1 items-center gap-0.5 lg:flex-none lg:ml-3">
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
          className={arrowButton}
          title={`${t('next')} (→)`}
          aria-label={t('next')}
        >
          <ChevronRight />
        </button>
        {/* Auf schmalen Geräten ersetzt der Titel den "Heute"-Knopf. */}
        <h1 className="ml-0.5 min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] lg:ml-1.5 lg:text-[14px]">
          <button
            type="button"
            onClick={onToday}
            title={`${t('today')} (T)`}
            className="block max-w-full truncate rounded-[var(--radius-sm)] px-1 py-1
                       hover:bg-[var(--canvas)] lg:py-0.5"
          >
            <span className="lg:hidden">{mobileTitle}</span>
            <span className="hidden lg:inline">{title}</span>
          </button>
        </h1>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 lg:gap-1.5">
        <div className="hidden h-9 items-center rounded-[var(--radius-sm)] border border-line md:flex lg:h-7">
          {jumps.map((jump, index) => (
            <button
              key={jump.offset}
              type="button"
              onClick={() => onJumpDay(jump.offset)}
              title={jump.offset === 0 ? `${jump.label} (T)` : jump.label}
              className={`h-full px-2.5 text-[13px] transition-colors lg:text-[12px] ${index > 0 ? 'hairline-l' : ''} ${
                selectedDay === jump.day ? 'text-text' : 'text-muted hover:text-text'
              }`}
            >
              {jump.label}
            </button>
          ))}
        </div>

        <div
          role="tablist"
          aria-label={t('view')}
          className="flex h-9 items-center rounded-[var(--radius-sm)] border border-line p-[2px] lg:h-7"
        >
          {views.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={view === item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              title={`${item.label} (${item.short})`}
              className={`h-full min-w-7 rounded-[3px] px-1.5 text-[13px] transition-colors
                          lg:h-[22px] lg:min-w-0 lg:px-2 lg:text-[12px] ${item.wide ? 'hidden lg:block' : ''} ${
                view === item.id
                  ? 'bg-[var(--canvas)] text-text shadow-[0_0_0_1px_var(--line)]'
                  : 'text-muted hover:text-text'
              }`}
            >
              <span className="hidden lg:inline">{item.label}</span>
              <span className="lg:hidden">{item.short}</span>
            </button>
          ))}
        </div>

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

        <button
          type="button"
          onClick={onOpenShortcuts}
          title={`${t('shortcuts')} (?)`}
          aria-label={t('shortcuts')}
          className={`hidden ${iconButton} lg:grid`}
        >
          <Keyboard />
        </button>

        {/* Auf schmalen Geräten wandert die Einstellung in die Fussleiste der
            Filter – die Kopfzeile braucht den Platz für den Titel. */}
        <Link
          href="/settings"
          aria-label={t('settings')}
          title={t('settings')}
          className={`hidden ${iconButton} lg:grid`}
        >
          <Settings />
        </Link>

        <ShareButton
          url={shareUrl}
          title={t('appName')}
          label={t('shareWebsite')}
          visibleLabel={t('share')}
          copiedLabel={t('menuLinkCopied')}
          umamiEvent="share-website"
          className="hidden h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2
                     text-[12px] text-muted hover:bg-[var(--canvas)] hover:text-text lg:flex"
        />

        <AppMenu cityId={cityId} shareUrl={shareUrl} className={iconButton} />
      </div>
    </header>
  );
}
