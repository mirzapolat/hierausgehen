import { useCallback, useMemo, useState } from 'react';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { sourceColor, sourceName } from '@/lib/events/display';
import { useSavedEvents } from '@/lib/saved';
import { useSettings } from '@/lib/settings/context';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { saveChoices } from './SaveButton';
import { Calendar, Check, External, Filter, Link as LinkIcon } from './icons';

/**
 * Das Kontextmenü an einem Termin, gleich in welcher Ansicht.
 *
 * Ein einziger Zuhörer für alle Ansichten: das Menü hängt am Termin im DOM
 * (`data-event-id`), nicht an jeder Liste einzeln. `openMenu` gehört deshalb
 * an einen gemeinsamen Vorfahren, `element` irgendwo in den Baum.
 */
export function useEventMenu({
  events,
  definitions,
  savedEvents,
  cityId,
  eventLink,
  onSelectEvent,
  onShowPerformances,
  onOnlySource,
  onOnlyTitle,
}: {
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  savedEvents: ReturnType<typeof useSavedEvents>;
  cityId: string;
  /** Der vollständige Link auf einen Termin. */
  eventLink: (event: CalendarEvent) => string;
  onSelectEvent: (event: CalendarEvent) => void;
  /** Rollt die weiteren Termine im Detail ins Bild. */
  onShowPerformances: () => void;
  onOnlySource: (sourceId: string) => void;
  onOnlyTitle: (title: string) => void;
}) {
  const { t } = useSettings();
  /** Offenes Kontextmenü samt Zeigerposition; `null` heisst geschlossen. */
  const [menu, setMenu] = useState<{ x: number; y: number; event: CalendarEvent } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const close = useCallback(() => setMenu(null), []);

  const copyLink = useCallback(
    async (event: CalendarEvent) => {
      const url = eventLink(event);
      try {
        await navigator.clipboard.writeText(url);
        setLinkCopied(true);
        return;
      } catch {
        // Ohne Zwischenablage (unsicherer Kontext, verweigerte Freigabe) bleibt
        // das Teilen-Menü des Geräts.
      }
      try {
        await navigator.share?.({ url });
      } catch {
        // Abgebrochenes Teilen ist kein Fehler.
      }
    },
    [eventLink],
  );

  const openMenu = useCallback(
    (e: React.MouseEvent) => {
      const element = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-event-id]');
      const event = events.find((candidate) => candidate.id === element?.dataset.eventId);
      if (!element || !event) return;
      e.preventDefault();
      setLinkCopied(false);
      // Über die Tastatur ausgelöst liefern manche Browser keine Zeigerposition.
      const rect = element.getBoundingClientRect();
      const pointed = e.clientX !== 0 || e.clientY !== 0;
      setMenu({ x: pointed ? e.clientX : rect.left, y: pointed ? e.clientY : rect.bottom, event });
    },
    [events],
  );

  const items = useMemo<MenuItem[]>(() => {
    const event = menu?.event;
    if (!event) return [];
    return [
      {
        key: 'link',
        label: linkCopied ? t('menuLinkCopied') : t('menuCopyLink'),
        icon: linkCopied ? <Check className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" />,
        keepOpen: true,
        onSelect: () => void copyLink(event),
      },
      {
        key: 'site',
        label: t('toEvent'),
        icon: <External className="h-3.5 w-3.5" />,
        onSelect: () => window.open(event.url, '_blank', 'noopener,noreferrer'),
      },
      ...saveChoices(event, savedEvents, t, cityId),
      {
        key: 'related',
        label: t('menuRelated'),
        icon: <Calendar className="h-3.5 w-3.5" />,
        disabled: !event.relatedPerformances?.length,
        onSelect: () => {
          onSelectEvent(event);
          onShowPerformances();
        },
      },
      {
        key: 'source',
        label: t('menuOnlySource', { name: sourceName(definitions, event.sourceId) }),
        icon: (
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: sourceColor(definitions, event.sourceId) }}
          />
        ),
        onSelect: () => onOnlySource(event.sourceId),
      },
      {
        key: 'title',
        label: t('menuOnlyTitle'),
        icon: <Filter className="h-3.5 w-3.5" />,
        onSelect: () => onOnlyTitle(event.title),
      },
    ];
  }, [menu, linkCopied, copyLink, onSelectEvent, onShowPerformances, onOnlySource, onOnlyTitle, definitions, savedEvents, cityId, t]);

  const element = menu && (
    <ContextMenu x={menu.x} y={menu.y} items={items} label={t('eventOptions')} onClose={close} />
  );

  return { open: Boolean(menu), openMenu, close, element };
}
