'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { cities } from '@/lib/cities';
import { useSettings } from '@/lib/settings/context';
import { programmePath } from '@/lib/site';
import { Checkbox } from './Checkbox';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { MoreHorizontal, Share } from './icons';
import { shareLink } from './ShareButton';

const DONATE_URL = 'https://donate.stripe.com/aFa8wO78f6zndFp2xF0kE03';

/**
 * Das Drei-Punkte-Menü ganz rechts in der Kopfzeile. Es sammelt alles, was
 * nicht zum Kalender selbst gehört: Impressum, Status, Export, die lesbaren
 * Programmübersichten, Teilen und Unterstützen.
 */
export function AppMenu({ cityId, shareUrl, className }: { cityId: string; shareUrl: string; className: string }) {
  const { t } = useSettings();
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; narrow: boolean }>();
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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
      // Ab `lg` steht „Teilen“ schon in der Kopfzeile.
      narrow: !window.matchMedia('(min-width: 64rem)').matches,
    });
  };

  const items: MenuItem[] = [
    ...(anchor?.narrow
      ? [
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
        ]
      : []),
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
    ...cities.map((city) => ({
      key: `programme-${city.id}`,
      label: t('cityProgramme', { city: city.name }),
      onSelect: () => router.push(programmePath(city.id)),
    })),
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
    </div>
  );
}

/**
 * Auswahl der Städte für den CSV-Export – voreingestellt alle, denn der
 * Endpunkt ohne Parameter meint denselben ganzen Bestand.
 */
function ExportPanel({ onClose }: { onClose: () => void }) {
  const { t } = useSettings();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(cities.map((city) => city.id)));
  const panel = useRef<HTMLDivElement>(null);

  // Alles, was das Feld aus dem Zusammenhang reisst, schliesst es.
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
  }, [onClose]);

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
