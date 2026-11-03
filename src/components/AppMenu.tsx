'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { ANNOUNCEMENTS, currentAnnouncements } from '@/lib/announcements';
import { announcementDevice, isStandalone } from './AnnouncementDialog';
import { cities, cityById } from '@/lib/cities';
import { GROUP_COLORS } from '@/lib/events/groups';
import { feedSearchParams, type FeedFilter } from '@/lib/events/filter';
import { rememberReturn } from '@/lib/return-path';
import { useSettings } from '@/lib/settings/context';
import { Checkbox } from './Checkbox';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Calendar, Check, External, Keyboard, Link as LinkIcon, MoreHorizontal, Settings, Share } from './icons';
import { shareLink } from './ShareButton';

const DONATE_URL = 'https://donate.stripe.com/aFa8wO78f6zndFp2xF0kE03';

/**
 * Das Drei-Punkte-Menü ganz rechts in der Kopfzeile. Es sammelt alles, was
 * nicht zum Kalender selbst gehört: Teilen, Abo, Einstellungen, Tastenkürzel,
 * Unterstützen, Status und Impressum.
 */
export function AppMenu({
  cityId,
  onCityChange,
  shareUrl,
  feedFilter,
  onOpenShortcuts,
  onOpenNews,
  className,
}: {
  cityId: string;
  /** Auf schmalen Geräten wird die Stadt hier gewählt statt in der Kopfzeile. */
  onCityChange: (id: string) => void;
  shareUrl: string;
  feedFilter: FeedFilter;
  onOpenShortcuts: () => void;
  /** Die neueste Ankündigung noch einmal zeigen (`AnnouncementDialog`). */
  onOpenNews?: () => void;
  className: string;
}) {
  const { format, t } = useSettings();
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; narrow: boolean }>();
  const [copied, setCopied] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  // Ein Klick auf den Knopf bei offenem Menü schliesst es zuerst über das
  // Menü selbst (dessen Zuhörer am Fenster kommt vor dem Knopf dran). Ohne
  // diese Marken öffnete der zugehörige Klick es gleich wieder.
  const justClosed = useRef(false);
  const swallowClick = useRef(false);

  const close = () => {
    // Nur für den laufenden Zeigerdruck: der Knopf fragt synchron danach.
    justClosed.current = true;
    setTimeout(() => (justClosed.current = false), 0);
    setAnchor(undefined);
    setCopied(false);
  };

  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      x: rect.right,
      y: rect.bottom + 4,
      // Tastenkürzel gibt es erst ab `lg`, darunter fehlt die Tastatur.
      narrow: !window.matchMedia('(min-width: 64rem)').matches,
    });
  };

  // Unterhalb von `lg` steht die Stadtauswahl nicht in der Kopfzeile, sondern
  // als erster Abschnitt hier, die gewählte mit Häkchen.
  const cityItems: MenuItem[] = anchor?.narrow
    ? cities.map((city) => ({
        key: `city-${city.id}`,
        label: city.name,
        icon: <Check className={`h-3.5 w-3.5 ${city.id === cityId ? 'text-accent' : 'text-transparent'}`} />,
        onSelect: () => {
          if (city.id !== cityId) onCityChange(city.id);
        },
      }))
    : [];

  // „Neuigkeiten“ nur, wenn es für dieses Gerät gerade eine gibt.
  const hasNews =
    Boolean(onOpenNews) &&
    currentAnnouncements(ANNOUNCEMENTS, {
      today: format.today(),
      device: anchor ? announcementDevice() : 'desktop',
      standalone: anchor ? isStandalone() : false,
    }).length > 0;

  const items: MenuItem[] = [
    ...cityItems,
    ...(hasNews && onOpenNews
      ? [
          {
            key: 'news',
            divider: cityItems.length > 0,
            label: t('newsMenu'),
            // Derselbe Ring wie in der Ankündigung und im App-Icon.
            icon: <NewsRing />,
            onSelect: onOpenNews,
          },
        ]
      : []),
    {
      key: 'share',
      divider: cityItems.length > 0 && !hasNews,
      label: copied ? t('menuLinkCopied') : t('shareWebsite'),
      icon: <Share className="h-3.5 w-3.5" />,
      keepOpen: true,
      onSelect: () => {
        track('share-website');
        void shareLink(shareUrl, t('appName')).then((result) => {
          if (result === 'copied') setCopied(true);
          else if (result === 'shared') close();
        });
      },
    },
    {
      key: 'subscribe',
      label: t('subscribe'),
      icon: <Calendar className="h-3.5 w-3.5" />,
      onSelect: () => setSubscribeOpen(true),
    },
    {
      key: 'settings',
      label: t('settings'),
      icon: <Settings className="h-3.5 w-3.5" />,
      onSelect: () => {
        // Damit „Zurück" wieder genau hier landet – Ansicht, Tag, offener Termin.
        rememberReturn();
        router.push('/settings');
      },
    },
    ...(anchor?.narrow
      ? []
      : [
          {
            key: 'shortcuts',
            label: `${t('shortcuts')} (?)`,
            icon: <Keyboard className="h-3.5 w-3.5" />,
            onSelect: onOpenShortcuts,
          },
        ]),
    {
      key: 'donate',
      label: t('donate'),
      icon: <Heart />,
      onSelect: () => window.open(DONATE_URL, '_blank', 'noopener,noreferrer'),
    },
    {
      key: 'status',
      label: t('status'),
      onSelect: () => router.push(`/status?city=${encodeURIComponent(cityId)}`),
    },
    { key: 'imprint', label: t('imprint'), onSelect: () => router.push('/impressum') },
  ];

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        onPointerDown={() => (swallowClick.current = justClosed.current)}
        onClick={() => {
          if (swallowClick.current) {
            swallowClick.current = false;
            return;
          }
          if (anchor) close();
          else open();
        }}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-label={t('appMenu')}
        title={t('appMenu')}
        className={className}
      >
        <MoreHorizontal />
      </button>
      {anchor && (
        <ContextMenu x={anchor.x} y={anchor.y} items={items} label={t('appMenu')} onClose={close} />
      )}
      {subscribeOpen && (
        <SubscribePanel cityId={cityId} filter={feedFilter} onClose={() => setSubscribeOpen(false)} />
      )}
    </div>
  );
}

/**
 * Kalender-Abo: eine Adresse, die Kalender-Apps selbst regelmässig abfragen.
 * Greifen gerade Filter, lässt sich wählen, ob das Abo sie übernimmt –
 * voreingestellt ja, denn wer filtert, hat gesagt, was er sehen will.
 */
function SubscribePanel({
  cityId,
  filter,
  onClose,
}: {
  cityId: string;
  filter: FeedFilter;
  onClose: () => void;
}) {
  const { t } = useSettings();
  const panel = useRef<HTMLDivElement>(null);
  const [withFilters, setWithFilters] = useState(true);
  const [copied, setCopied] = useState(false);
  useDismiss(panel, onClose);

  const filtered = feedSearchParams(cityId, filter);
  const hasFilters = [...filtered.keys()].some((key) => key !== 'city');
  const params = hasFilters && withFilters ? filtered : feedSearchParams(cityId, {});
  const httpsUrl = `${window.location.origin}/api/events/feed?${params}`;
  // `webcal:` öffnet auf Apple-Geräten und in Outlook direkt den Abo-Dialog.
  const webcalUrl = httpsUrl.replace(/^https?:/, 'webcal:');
  const googleUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`;
  const tracked = () => track('calendar-subscribe', { city: cityId, filtered: hasFilters && withFilters ? 1 : 0 });

  const action =
    'flex h-8 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-[12px] text-text hover:bg-[var(--chrome)]';

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={t('subscribe')}
      className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] rounded-[var(--radius-md)]
                 border border-line bg-[var(--raised)] p-3"
      style={{ boxShadow: 'var(--shadow-overlay)' }}
    >
      <p className="text-[13px] font-medium text-text">
        {t('subscribe')} · {cityById(cityId).name}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{t('subscribeLead')}</p>
      {hasFilters && (
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-text">
          <Checkbox
            state={withFilters ? 'on' : 'off'}
            label={t('subscribeWithFilters')}
            onChange={() => setWithFilters((current) => !current)}
          />
          {t('subscribeWithFilters')}
        </label>
      )}
      <div className="mt-3 flex flex-col gap-0.5 border-t border-line pt-2">
        <a href={webcalUrl} onClick={tracked} className={action}>
          <Calendar className="h-3.5 w-3.5 text-muted" />
          {t('subscribeOpen')}
        </a>
        <a href={googleUrl} target="_blank" rel="noopener noreferrer" onClick={tracked} className={action}>
          <External className="h-3.5 w-3.5 text-muted" />
          {t('subscribeGoogle')}
        </a>
        <button
          type="button"
          onClick={() => {
            tracked();
            void navigator.clipboard
              ?.writeText(httpsUrl)
              .then(() => setCopied(true))
              .catch(() => undefined);
          }}
          className={`${action} text-left`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <LinkIcon className="h-3.5 w-3.5 text-muted" />}
          {copied ? t('subscribeCopied') : t('subscribeCopy')}
        </button>
      </div>
    </div>
  );
}

/** Alles, was ein Feld aus dem Zusammenhang reisst, schliesst es. */
function useDismiss(panel: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [panel, onClose]);
}

/** Kleiner Ring in den Ordnerfarben, das Zeichen für Neuigkeiten. */
const NewsRing = () => {
  const ring = [
    GROUP_COLORS.Theater,
    GROUP_COLORS.Kino,
    GROUP_COLORS.Literatur,
    GROUP_COLORS.Kultur,
    GROUP_COLORS.Konzert,
    GROUP_COLORS['Oper & Ballett'],
    GROUP_COLORS.Club,
    GROUP_COLORS.Theater,
  ].join(', ');
  const mask = 'radial-gradient(farthest-side, transparent 50%, black 54%)';
  return (
    <span
      aria-hidden="true"
      className="block h-3.5 w-3.5 rounded-full"
      style={{ background: `conic-gradient(${ring})`, mask, WebkitMask: mask }}
    />
  );
};

const Heart = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 shrink-0 text-red-500">
    <path d="M12 21s-9-5.5-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.5-9 12-9 12Z" />
  </svg>
);
