'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { cities, cityById } from '@/lib/cities';
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
 * Unterstützen, Export, Status und Impressum.
 */
export function AppMenu({
  cityId,
  shareUrl,
  feedFilter,
  onOpenShortcuts,
  className,
}: {
  cityId: string;
  shareUrl: string;
  feedFilter: FeedFilter;
  onOpenShortcuts: () => void;
  className: string;
}) {
  const { t } = useSettings();
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; narrow: boolean }>();
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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

  const items: MenuItem[] = [
    {
      key: 'share',
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
      key: 'export',
      label: t('exportCsv'),
      onSelect: () => {
        if (cities.length < 2) {
          track('csv-export', { cities: cities[0].id, count: 1 });
          download('/api/events/export');
        } else {
          setExportOpen(true);
        }
      },
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
      {exportOpen && <ExportPanel onClose={() => setExportOpen(false)} />}
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

/**
 * Auswahl der Städte für den CSV-Export – voreingestellt alle, denn der
 * Endpunkt ohne Parameter meint denselben ganzen Bestand.
 */
function ExportPanel({ onClose }: { onClose: () => void }) {
  const { t } = useSettings();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(cities.map((city) => city.id)));
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(panel, onClose);

  const chosen = cities.filter((city) => selected.has(city.id)).map((city) => city.id);
  const href = `/api/events/export?${chosen.map((id) => `city=${encodeURIComponent(id)}`).join('&')}`;

  return (
    <div
      ref={panel}
      className="absolute right-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-[var(--radius-md)]
                 border border-line bg-[var(--raised)] p-3"
      style={{ boxShadow: 'var(--shadow-overlay)' }}
    >
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
        {t('exportCities')}
      </p>
      <ul className="flex flex-col gap-1.5">
        {cities.map((city) => (
          <li key={city.id}>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text">
              <Checkbox
                state={selected.has(city.id) ? 'on' : 'off'}
                label={city.name}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (!next.delete(city.id)) next.add(city.id);
                    return next;
                  })
                }
              />
              {city.name}
            </label>
          </li>
        ))}
      </ul>
      {/* Kein <Link>: die CSV kommt von der API, sie ist keine Seite. */}
      <a
        href={href}
        download
        aria-disabled={selected.size === 0}
        onClick={(event) => {
          if (selected.size === 0) {
            event.preventDefault();
            return;
          }
          track('csv-export', { cities: chosen.join(','), count: chosen.length });
          onClose();
        }}
        className={`mt-3 block rounded-[var(--radius-sm)] px-2 py-1.5 text-center text-[12px]
                    font-medium transition-colors ${
                      selected.size === 0
                        ? 'cursor-not-allowed bg-[var(--chrome)] text-faint'
                        : 'bg-[var(--accent)] text-white hover:opacity-90'
                    }`}
      >
        {t('exportDownload')}
      </a>
    </div>
  );
}

function download(href: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const Heart = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 shrink-0 text-red-500">
    <path d="M12 21s-9-5.5-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.5-9 12-9 12Z" />
  </svg>
);
