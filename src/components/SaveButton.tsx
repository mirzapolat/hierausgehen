'use client';

import { useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import type { MessageKey } from '@/lib/i18n';
import { useSavedEvents, type SavableEvent } from '@/lib/saved';
import { useSettings } from '@/lib/settings/context';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Bookmark, Calendar, Close, Search } from './icons';

type SavedApi = ReturnType<typeof useSavedEvents>;
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Was sich mit dem Termin auf der Merkliste anfangen lässt. Gehört er zu
 * einer Reihe oder kam er über eine gemerkte Suche, gibt es mehr als einen
 * Weg – dann fragt die Oberfläche nach. Sonst ist es genau ein Eintrag.
 */
export function saveChoices(
  event: SavableEvent,
  saved: SavedApi,
  t: Translate,
  cityId: string | undefined,
): MenuItem[] {
  const series = saved.partOfSeries(event);
  if (!saved.isSaved(event, cityId)) {
    const single: MenuItem = {
      key: 'save-event',
      label: series ? t('saveEvent') : t('save'),
      icon: <Bookmark className="h-3.5 w-3.5" />,
      onSelect: () => {
        saved.save(event, 'event', cityId);
        track('event-save', { source: event.sourceId, category: event.category });
      },
    };
    if (!series) return [single];
    return [
      single,
      {
        key: 'save-series',
        label: t('saveSeries'),
        icon: <Calendar className="h-3.5 w-3.5" />,
        onSelect: () => {
          saved.save(event, 'series', cityId);
          track('event-save-series', { source: event.sourceId, category: event.category });
        },
      },
    ];
  }

  const searches = saved
    .reasons(event, cityId)
    .flatMap((reason) => (reason.kind === 'search' ? [reason.query] : []));
  const asks = series || searches.length > 0;
  return [
    {
      key: 'unsave-event',
      label: asks ? t('unsaveEvent') : t('unsave'),
      icon: <Close className="h-3.5 w-3.5" />,
      onSelect: () => saved.unsave(event, { kind: 'event' }, cityId),
    },
    ...(series
      ? [
          {
            key: 'unsave-series',
            label: t('unsaveSeries'),
            icon: <Calendar className="h-3.5 w-3.5" />,
            onSelect: () => saved.unsave(event, { kind: 'series' }, cityId),
          },
        ]
      : []),
    ...searches.map((query) => ({
      key: `unsave-search-${query}`,
      label: t('unsaveSearchNamed', { query }),
      icon: <Search className="h-3.5 w-3.5" />,
      onSelect: () => saved.unsave(event, { kind: 'search', query }, cityId),
    })),
  ];
}

interface Props {
  event: SavableEvent;
  /** Stadt des Termins; ohne Angabe die eingestellte. */
  cityId?: string;
  className: (saved: boolean) => string;
  iconClassName?: string;
}

/**
 * Das Lesezeichen an einem Termin. Gibt es nur einen Weg, wirkt der Klick
 * sofort; sonst klappt darunter die Auswahl auf – nur dieser Termin, die
 * ganze Reihe oder die Suche, die ihn gemerkt hat.
 */
export function SaveButton({ event, cityId, className, iconClassName = 'h-3.5 w-3.5' }: Props) {
  const settings = useSettings();
  const { t } = settings;
  const city = cityId ?? settings.cityId;
  const saved = useSavedEvents(city);
  const isSaved = saved.isSaved(event);
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] }>();

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-pressed={isSaved}
        aria-haspopup="menu"
        aria-label={isSaved ? t('unsave') : t('save')}
        title={isSaved ? t('unsave') : t('save')}
        onClick={() => {
          const items = saveChoices(event, saved, t, city);
          if (items.length === 1) {
            items[0].onSelect();
            return;
          }
          const rect = button.current!.getBoundingClientRect();
          setMenu({ x: rect.left, y: rect.bottom + 4, items });
        }}
        className={className(isSaved)}
      >
        <Bookmark filled={isSaved} className={iconClassName} />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          label={isSaved ? t('unsave') : t('save')}
          onClose={() => setMenu(undefined)}
        />
      )}
    </>
  );
}
