'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import {
  ANNOUNCEMENTS,
  currentAnnouncements,
  pickAnnouncement,
  readSeen,
  writeSeen,
  type Announcement,
  type AnnouncementIcon,
  type AnnouncementKind,
} from '@/lib/announcements';
import { GROUP_COLORS, type EventGroup } from '@/lib/events/groups';
import type { MessageKey } from '@/lib/i18n';
import { useSettings } from '@/lib/settings/context';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useOverlayTransition } from '@/lib/useOverlayTransition';
import { BottomSheet } from './BottomSheet';
import { Bookmark, Calendar, ChevronDown, Map, MapPin, MoreHorizontal, Refresh, Search, Share, Ticket } from './icons';

/** Kurz warten, bis der Kalender steht: die Ankündigung soll nicht mit ihm aufblitzen. */
const SHOW_AFTER_MS = 700;

const COMPACT_QUERY = '(max-width: 63.999rem)';

/** Die Ordnerfarben einmal um den Kreis, wie im App-Icon (`scripts/icons.ts`). */
const RING_ORDER: EventGroup[] = ['Theater', 'Kino', 'Literatur', 'Kultur', 'Konzert', 'Oper & Ballett', 'Club'];

const KIND_LABEL: Record<AnnouncementKind, MessageKey> = {
  feature: 'newsKindFeature',
  notice: 'newsKindNotice',
  tip: 'newsKindTip',
};

const ICONS: Record<AnnouncementIcon, (props: { className?: string }) => React.ReactNode> = {
  calendar: Calendar,
  swipe: ChevronDown,
  pin: MapPin,
  refresh: Refresh,
  search: Search,
  bookmark: Bookmark,
  ticket: Ticket,
  map: Map,
  share: Share,
  more: MoreHorizontal,
};

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Telefon heisst: schmal oder als App vom Startbildschirm geöffnet. */
export function announcementDevice(): 'mobile' | 'desktop' {
  return window.matchMedia(COMPACT_QUERY).matches || isStandalone() ? 'mobile' : 'desktop';
}

/**
 * Ankündigung beim Start (siehe `lib/announcements.ts` für Regeln und Inhalt).
 *
 * Auf dem Telefon, dem eigentlichen Ort dafür, steht sie im selben Sheet wie
 * ein Termin: mit Griff, zum Herunterwischen, aber nur so hoch wie ihr
 * Inhalt. Am Schreibtisch ein ruhiger Dialog in der Mitte. Der Inhalt ist in
 * beiden derselbe.
 *
 * `reopen` zählt hoch, wenn jemand sie über „Neuigkeiten“ im Menü noch einmal
 * sehen will; dann erscheint die neueste, auch wenn sie schon gesehen war.
 */
export function AnnouncementDialog({ enabled, reopen }: { enabled: boolean; reopen: number }) {
  const { format, t } = useSettings();
  const compact = useMediaQuery(COMPACT_QUERY);
  const [item, setItem] = useState<Announcement>();
  const [open, setOpen] = useState(false);
  const overlay = useOverlayTransition(open, 200);
  const checked = useRef(false);
  const titleId = useId();

  // Einmal je Start, sobald der Kalender steht.
  useEffect(() => {
    if (!enabled || checked.current) return;
    checked.current = true;
    // Wer über einen geteilten Termin kommt, will diesen sehen, nichts anderes.
    if (new URLSearchParams(window.location.search).has('event')) return;

    const seen = readSeen();
    const pick = pickAnnouncement(ANNOUNCEMENTS, {
      seen,
      today: format.today(),
      device: announcementDevice(),
      standalone: isStandalone(),
    });
    // Beim ersten Besuch gilt alles Bisherige als gesehen: sonst käme es beim
    // zweiten Start als „neu“ daher.
    if (seen === null) writeSeen(ANNOUNCEMENTS.filter((entry) => entry.id !== pick?.id).map((entry) => entry.id));
    if (!pick) return;

    const timer = window.setTimeout(() => {
      setItem(pick);
      setOpen(true);
      track('announcement-show', { id: pick.id });
    }, SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, format]);

  // Auf Wunsch aus dem Menü: die neueste, ob gesehen oder nicht.
  useEffect(() => {
    if (!reopen) return;
    const latest = currentAnnouncements(ANNOUNCEMENTS, {
      today: format.today(),
      device: announcementDevice(),
      standalone: isStandalone(),
    })[0];
    if (!latest) return;
    // Ein Wunsch von aussen, kein Effekt-Kreislauf: genau einmal je Zählerstand.
    /* eslint-disable react-hooks/set-state-in-effect */
    setItem(latest);
    setOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [reopen, format]);

  const close = () => {
    setOpen(false);
    if (item) writeSeen([...(readSeen() ?? []), item.id]);
  };

  // Am Schreibtisch schliesst Escape; auf dem Telefon gibt es keine Tastatur.
  useEffect(() => {
    if (!open || compact) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!overlay.mounted || !item) return null;

  const content = (
    <AnnouncementContent
      item={item}
      titleId={titleId}
      kindLabel={t(KIND_LABEL[item.kind])}
      dateLabel={format.dayNoWeekday(item.date)}
      onClose={close}
    />
  );

  if (compact) {
    return (
      <BottomSheet shown={overlay.shown} onClose={close} closeLabel={t('close')} fit labelledBy={titleId}>
        {content}
      </BottomSheet>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <button
        type="button"
        aria-label={t('close')}
        onClick={close}
        className={`absolute inset-0 transition-opacity duration-200 ease-out ${overlay.shown ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'var(--overlay)' }}
      />
      <DesktopPanel shown={overlay.shown} titleId={titleId}>
        {content}
      </DesktopPanel>
    </div>
  );
}

function DesktopPanel({ shown, titleId, children }: { shown: boolean; titleId: string; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // Der Fokus gehört dem Dialog, damit Tab und Screenreader dort beginnen.
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`relative max-h-[calc(100dvh-3rem)] w-full max-w-[440px] overflow-y-auto scroll-quiet
                  rounded-[var(--radius-lg)] border border-line bg-[var(--raised)] outline-none
                  transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]
                  ${shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-1 scale-[0.98] opacity-0'}`}
      style={{ boxShadow: 'var(--shadow-overlay)' }}
    >
      {children}
    </div>
  );
}

/**
 * Der Inhalt, für Sheet und Dialog gleich: oben der Ring als Marke, darunter
 * Art und Datum klein, der Titel, ein Satz dazu und die einzelnen Punkte als
 * Zeilen mit feinen Linien, keine Karten. Unten ein Knopf, der über die
 * ganze Breite geht: auf dem Finger leicht zu treffen, am Schreibtisch klar.
 */
function AnnouncementContent({
  item,
  titleId,
  kindLabel,
  dateLabel,
  onClose,
}: {
  item: Announcement;
  titleId: string;
  kindLabel: string;
  dateLabel: string;
  onClose: () => void;
}) {
  const { settings, t } = useSettings();
  const locale = settings.locale;
  const ring = RING_ORDER.map((group) => GROUP_COLORS[group]);

  const primary =
    'flex h-12 w-full items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)] text-[15px] ' +
    'font-medium text-white transition-opacity hover:opacity-90 lg:h-10 lg:text-[14px]';

  return (
    <div className="px-6 pb-5 pt-2 lg:px-7 lg:pb-6 lg:pt-7">
      <span
        aria-hidden="true"
        className="block h-10 w-10 rounded-full"
        style={{
          background: `conic-gradient(${[...ring, ring[0]].join(', ')})`,
          mask: 'radial-gradient(farthest-side, transparent 56%, black 58%)',
          WebkitMask: 'radial-gradient(farthest-side, transparent 56%, black 58%)',
        }}
      />

      <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
        <span className="text-accent">{kindLabel}</span>
        <span className="mx-1.5">·</span>
        {dateLabel}
      </p>
      <h2 id={titleId} className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-text">
        {item.title[locale]}
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted lg:text-[14px]">{item.lead[locale]}</p>

      {item.items && item.items.length > 0 && (
        <ul className="mt-5 border-t border-line">
          {item.items.map((entry) => {
            const Icon = ICONS[entry.icon];
            return (
              <li key={entry.title.de} className="flex gap-3.5 py-3.5 hairline-b last:border-b-0">
                <span
                  aria-hidden="true"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--sunken)] text-muted"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 pt-px">
                  <span className="block text-[15px] font-medium text-text lg:text-[14px]">{entry.title[locale]}</span>
                  <span className="mt-0.5 block text-[14px] leading-snug text-muted lg:text-[13px]">
                    {entry.text[locale]}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 flex flex-col gap-1.5">
        {item.action ? (
          <>
            <a
              href={item.action.href}
              onClick={() => {
                track('announcement-action', { id: item.id });
                onClose();
              }}
              className={primary}
            >
              {item.action.label[locale]}
            </a>
            <button
              type="button"
              onClick={onClose}
              className="h-11 w-full rounded-[var(--radius-md)] text-[15px] text-muted hover:text-text lg:h-9 lg:text-[14px]"
            >
              {t('newsLater')}
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose} className={primary}>
            {t('newsDismiss')}
          </button>
        )}
      </div>
    </div>
  );
}
