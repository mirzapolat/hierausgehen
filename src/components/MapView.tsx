'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { cityById } from '@/lib/cities';
import { availabilityKeys, displayAvailability, sourceColor } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';
import { AvailabilityDot } from './AvailabilityDot';
import { Close, Minus, Plus, Target } from './icons';

interface Props {
  day: string;
  /** Bereits gefilterte Termine dieses Tages. */
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  cityId: string;
  selectedEventId?: string;
  onSelectEvent: (event: CalendarEvent) => void;
}

/**
 * Kartenansicht: die Termine eines Tages als Orte.
 *
 * Das ist eine Tagesansicht mit anderen Mitteln – dieselben gefilterten
 * Termine wie in "Tag", nur nach Ort sortiert statt nach Uhrzeit. Die Frage
 * dahinter ist eine andere: nicht "was läuft heute", sondern "was läuft heute
 * in meiner Nähe".
 *
 * Ein Pin ist deshalb ein **Ort**, kein Termin. Sechs Vorstellungen im
 * Deutschen Theater sind ein Punkt mit einer Sechs, nicht sechs Punkte
 * übereinander; der Ring darum zeigt die Ordnerfarben der beteiligten
 * Quellen. Ein Klick öffnet die Liste des Ortes, ein Termin daraus füllt wie
 * überall die Detailspalte rechts.
 *
 * Karten brauchen sonst einen Schlüssel und eine Registrierung. Hier nicht:
 * die Kacheln kommen direkt von OpenStreetMap. Deren Standardstil ist bunter,
 * als es hierher passt – Wiesen grün, Straßen gelb –, deshalb liegt ein
 * Filter darauf (`globals.css`), der ihn entsättigt und im dunklen Schema
 * umkehrt. Der Filter sitzt auf der Kachelebene, nicht auf der Karte: die
 * Pins sollen ihre Ordnerfarben behalten. Leaflet und die Kacheln werden erst
 * geladen, wenn diese Ansicht zum ersten Mal geöffnet wird.
 *
 * Termine ohne Ort verschwinden nicht: sie stehen unter der Karte. Wo die
 * Punkte herkommen und warum manche fehlen, steht in `lib/events/geocode.ts`.
 */

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Ein Knopf, der über der Karte schwebt: rund, aus Milchglas, mit Druckpunkt. */
const glassButton =
  'map-glass grid h-9 w-9 place-items-center rounded-full text-muted ' +
  'transition-[transform,color] duration-150 hover:scale-105 hover:text-text active:scale-95';

/** Ein Ort mit allem, was an ihm an diesem Tag stattfindet. */
interface Place {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  events: CalendarEvent[];
  /** Farben der beteiligten Quellen, in der Reihenfolge der Termine. */
  colors: string[];
}

export function MapView({
  day,
  events,
  definitions,
  cityId,
  selectedEventId,
  onSelectEvent,
}: Props) {
  const { format, t } = useSettings();
  const dark = useDarkTiles();
  const city = cityById(cityId);

  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const tiles = useRef<Leaflet.TileLayer | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  /** Für welchen Tag der Ausschnitt zuletzt gesetzt wurde. */
  const fitted = useRef<string>('');
  const [ready, setReady] = useState(false);
  /**
   * Der von Hand geöffnete Ort – mitsamt der Auswahl, unter der er geöffnet
   * wurde. Beides zusammen, weil zwei Wege denselben Ort öffnen: ein Klick auf
   * den Pin und die Auswahl eines Termins anderswo (Pfeiltasten, Detailspalte,
   * Suche). Wer zuletzt gehandelt hat, gewinnt – und das steht hier, statt in
   * einem Effekt, der dem anderen Zustand hinterherräumt.
   */
  const [pinned, setPinned] = useState<{ key?: string; forSelection?: string }>({});

  const places = useMemo(() => groupByPlace(events, definitions), [events, definitions]);
  const unplaced = useMemo(() => events.filter((event) => !event.venue.place), [events]);
  const [unplacedOpen, setUnplacedOpen] = useState(false);

  const selectedKey = places.find((place) =>
    place.events.some((event) => event.id === selectedEventId),
  )?.key;
  // Die Ortskarte bleibt offen, solange sich die Auswahl nicht bewegt hat.
  const openPlace = pinned.forSelection === selectedEventId ? pinned.key : selectedKey;
  const active = places.find((place) => place.key === openPlace);
  /**
   * Welcher Pin hervorgehoben ist. Nicht dasselbe wie die offene Ortskarte:
   * bei einem Ort mit nur einem Termin geht der Klick direkt in die
   * Detailspalte, ohne Karte – der Pin soll trotzdem zeigen, dass er gemeint
   * ist.
   */
  const highlightKey = openPlace ?? selectedKey;

  const openPin = useCallback(
    (key?: string) => setPinned({ key, forSelection: selectedEventId }),
    [selectedEventId],
  );

  /* ------------------------------- Aufbau ------------------------------- */

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;

    void (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !container.current || map.current) return;

      leaflet.current = L;
      map.current = L.map(container.current, {
        // Eigene Knöpfe, eigene Herkunftsangabe – der Standardlook von
        // Leaflet passt nicht zum Rest der Oberfläche.
        zoomControl: false,
        attributionControl: false,
        minZoom: 10,
        maxZoom: 18,
        zoomSnap: 0.5,
      }).setView([city.coordinates.latitude, city.coordinates.longitude], 12);

      // Ein Klick ins Leere schliesst die Ortskarte – wie überall sonst auch.
      map.current.on('click', () => setPinned({ key: undefined }));

      // Die Spalten links und rechts lassen sich ziehen und einklappen;
      // Leaflet merkt das von sich aus nur beim Fenster, nicht am Element.
      observer = new ResizeObserver(() => map.current?.invalidateSize({ animate: false }));
      observer.observe(container.current);

      setReady(true);
    })();

    const placed = markers.current;
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      placed.clear();
    };
    // Nur einmal: die Karte überlebt jeden Tageswechsel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------- Kacheln ------------------------------ */

  useEffect(() => {
    const L = leaflet.current;
    if (!ready || !L || !map.current || tiles.current) return;

    tiles.current = L.tileLayer(TILES, {
      maxZoom: 19,
      // Sichtbare Angabe steht als eigenes Element unten rechts.
      attribution: '',
    }).addTo(map.current);
  }, [ready]);

  /* -------------------------------- Pins -------------------------------- */

  useEffect(() => {
    const L = leaflet.current;
    if (!ready || !L || !map.current) return;

    for (const marker of markers.current.values()) marker.remove();
    markers.current.clear();

    for (const place of places) {
      const marker = L.marker([place.latitude, place.longitude], {
        icon: L.divIcon({
          html: pinHtml(place, place.key === highlightKey),
          className: 'map-pin-wrap',
          // Muss zu den Grössen in `globals.css` passen, sonst sitzt der
          // Punkt neben seinem Ort.
          iconSize: place.events.length > 1 ? [30, 30] : [18, 18],
          iconAnchor: place.events.length > 1 ? [15, 15] : [9, 9],
        }),
        title: `${place.name} – ${count(place.events.length, t)}`,
        keyboard: true,
        riseOnHover: true,
      });
      marker.on('click', () => {
        // Ein Ort mit einem einzigen Termin braucht keine Zwischenliste: der
        // Klick führt direkt in die Detailspalte. Die Auswahl steht dabei
        // schon fest, deshalb kann die Ortskarte gleich zubleiben.
        if (place.events.length === 1) {
          setPinned({ key: undefined, forSelection: place.events[0].id });
          onSelectEvent(place.events[0]);
          return;
        }
        openPin(place.key);
      });
      marker.addTo(map.current);
      markers.current.set(place.key, marker);
    }
  }, [ready, places, highlightKey, openPin, onSelectEvent, t]);

  /* ------------------------------ Ausschnitt ----------------------------- */

  const zoomIn = useCallback(() => map.current?.zoomIn(), []);
  const zoomOut = useCallback(() => map.current?.zoomOut(), []);

  const fit = useCallback(
    (animate = true) => {
      const L = leaflet.current;
      if (!L || !map.current) return;
      if (places.length === 0) {
        map.current.setView([city.coordinates.latitude, city.coordinates.longitude], 12, { animate });
        return;
      }
      map.current.fitBounds(
        L.latLngBounds(places.map((place) => [place.latitude, place.longitude] as [number, number])),
        { padding: [64, 64], maxZoom: 15, animate },
      );
    },
    [places, city],
  );

  // Ein neuer Tag heisst ein neuer Ausschnitt; innerhalb des Tages bleibt
  // stehen, wohin der Nutzer geschoben hat.
  useEffect(() => {
    if (!ready) return;
    const stamp = `${day}|${places.map((place) => place.key).join(',')}`;
    if (fitted.current === stamp) return;
    fitted.current = stamp;
    fit(false);
  }, [ready, day, places, fit]);

  // Auswahl von aussen (Pfeiltasten, Detailspalte, Suche): den Ort ins Bild
  // holen. Geöffnet ist er durch die Ableitung oben bereits.
  useEffect(() => {
    if (!ready || !selectedKey || !map.current) return;
    const place = places.find((candidate) => candidate.key === selectedKey);
    if (place) map.current.panTo([place.latitude, place.longitude], { animate: true, duration: 0.4 });
  }, [ready, selectedKey, places]);

  /* ------------------------------- Ansicht ------------------------------ */

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Kein eigener Tageskopf: das Datum steht schon in der Leiste, und dort
          wird es auch geblättert. Die Karte bekommt die ganze Fläche. */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={container}
          data-tiles={dark ? 'dark' : 'light'}
          className="absolute inset-0 z-0"
          aria-label={t('map')}
          role="application"
        />

        {/* Bedienung: runde Milchglasknöpfe, die über der Karte schweben. */}
        <div className="absolute right-3 top-3 z-[500] flex flex-col gap-2">
          <button
            type="button"
            onClick={zoomIn}
            title={t('zoomIn')}
            aria-label={t('zoomIn')}
            className={glassButton}
          >
            <Plus />
          </button>
          <button
            type="button"
            onClick={zoomOut}
            title={t('zoomOut')}
            aria-label={t('zoomOut')}
            className={glassButton}
          >
            <Minus />
          </button>
          <button
            type="button"
            onClick={() => fit()}
            title={t('mapFit')}
            aria-label={t('mapFit')}
            className={glassButton}
          >
            <Target />
          </button>
        </div>

        {places.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 z-[500] -translate-y-1/2 px-6 text-center text-[13px] text-faint">
            {events.length === 0 ? t('noEventsDay') : t('mapNoPlaces')}
          </p>
        )}

        {/* Ortskarte: was an diesem Punkt läuft. */}
        {active && (
          <div
            className="map-glass absolute bottom-3 left-3 z-[600] max-h-[min(60%,340px)] w-[280px]
                       overflow-hidden rounded-[20px]"
          >
            <div className="flex items-start gap-2 px-3 py-2.5 hairline-b">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{active.name}</div>
                <div className="text-[11px] text-muted">{count(active.events.length, t)}</div>
              </div>
              <button
                type="button"
                onClick={() => openPin(undefined)}
                aria-label={t('close')}
                className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-sm)]
                           text-muted hover:bg-[var(--chrome)] hover:text-text"
              >
                <Close className="h-3.5 w-3.5" />
              </button>
            </div>
            <ul className="max-h-[280px] overflow-y-auto scroll-quiet">
              {active.events.map((event) => {
                const availability = displayAvailability(event);
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      data-event-id={event.id}
                      onClick={() => onSelectEvent(event)}
                      aria-current={selectedEventId === event.id}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hairline-b
                                  ${
                                    selectedEventId === event.id
                                      ? 'bg-[var(--accent-soft)]'
                                      : 'hover:bg-[var(--chrome)]'
                                  }`}
                    >
                      <span className="w-[38px] shrink-0 text-[11px] tabular-nums text-muted">
                        {event.allDay ? '—' : format.time(event.start)}
                      </span>
                      <span
                        aria-hidden="true"
                        className="mt-[5px] h-[10px] w-[2px] shrink-0 rounded-full"
                        style={{ background: sourceColor(definitions, event.sourceId) }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium">{event.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                          <AvailabilityDot value={availability} />
                          <span className="truncate">{t(availabilityKeys[availability])}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Herkunft der Karte – Bedingung der Anbieter und schlicht fair. */}
        <div className="map-glass absolute bottom-2 right-2 z-[500] rounded-full px-2.5 py-0.5 text-[10px] text-faint">
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-muted"
          >
            © OpenStreetMap-Mitwirkende
          </a>
        </div>
      </div>

      {/* Ohne Ort ist nicht dasselbe wie nicht vorhanden. */}
      {unplaced.length > 0 && (
        <div className="shrink-0 hairline-t">
          <button
            type="button"
            onClick={() => setUnplacedOpen((open) => !open)}
            aria-expanded={unplacedOpen}
            className="flex w-full items-center gap-2 px-6 py-2 text-left text-[12px] text-muted hover:bg-[var(--chrome)]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--line-strong)]" aria-hidden="true" />
            {t('mapUnplaced', { count: unplaced.length })}
          </button>
          {unplacedOpen && (
            <ul className="max-h-[132px] overflow-y-auto scroll-quiet px-6 pb-2">
              {unplaced.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    data-event-id={event.id}
                    onClick={() => onSelectEvent(event)}
                    className="flex w-full items-baseline gap-2 py-1 text-left hover:text-accent"
                  >
                    <span className="w-[38px] shrink-0 text-[11px] tabular-nums text-muted">
                      {event.allDay ? '—' : format.time(event.start)}
                    </span>
                    <span className="truncate text-[12px]">{event.title}</span>
                    <span className="ml-auto shrink-0 truncate text-[11px] text-faint">
                      {event.venue.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Bausteine ------------------------------- */

/**
 * Termine zu Orten bündeln.
 *
 * Zusammen gehört, was denselben Punkt hat – die Räume eines Hauses fallen
 * dadurch von selbst zusammen, weil sie alle auf dessen Punkt aufgelöst
 * wurden.
 */
function groupByPlace(events: CalendarEvent[], definitions: SourceDefinition[]): Place[] {
  const places = new Map<string, Place>();

  for (const event of events) {
    const place = event.venue.place;
    if (!place) continue;
    const key = `${place.point.latitude.toFixed(5)},${place.point.longitude.toFixed(5)}`;
    const existing = places.get(key);
    if (existing) {
      existing.events.push(event);
      existing.colors.push(sourceColor(definitions, event.sourceId));
      continue;
    }
    places.set(key, {
      key,
      name: place.name,
      latitude: place.point.latitude,
      longitude: place.point.longitude,
      events: [event],
      colors: [sourceColor(definitions, event.sourceId)],
    });
  }

  for (const place of places.values()) {
    place.events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  }

  return [...places.values()].sort((a, b) => b.events.length - a.events.length);
}

/**
 * Der Pin. Ein einzelner Termin ist ein Punkt in der Farbe seines Ordners,
 * mehrere sind eine Scheibe mit der Anzahl und einem Ring, der die beteiligten
 * Ordner in ihren Anteilen zeigt.
 */
function pinHtml(place: Place, open: boolean): string {
  const state = open ? ' map-pin--open' : '';

  if (place.events.length === 1) {
    return `<span class="map-pin map-pin--single${state}" style="--pin: ${place.colors[0]}"></span>`;
  }

  return (
    `<span class="map-pin map-pin--group${state}" style="background: ${ring(place.colors)}">` +
    `<span class="map-pin__count">${place.events.length}</span></span>`
  );
}

/** Die Ordnerfarben als Kreissegmente – ein Ring statt einer Legende. */
function ring(colors: string[]): string {
  const shares = new Map<string, number>();
  for (const color of colors) shares.set(color, (shares.get(color) ?? 0) + 1);

  const stops: string[] = [];
  let at = 0;
  for (const [color, share] of shares) {
    const to = at + (share / colors.length) * 360;
    stops.push(`${color} ${at}deg ${to}deg`);
    at = to;
  }
  return `conic-gradient(${stops.join(', ')})`;
}

function count(value: number, t: (key: 'eventCountZero' | 'eventCountOne' | 'eventCountMany', params?: Record<string, string | number>) => string): string {
  if (value === 0) return t('eventCountZero');
  if (value === 1) return t('eventCountOne');
  return t('eventCountMany', { count: value });
}

/**
 * Welche Kachelfassung passt? Die Einstellung "System" muss dafür aufgelöst
 * werden – anders als beim CSS, das die Medienabfrage selbst kennt.
 */
function useDarkTiles(): boolean {
  const { settings } = useSettings();
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
}

export default MapView;
