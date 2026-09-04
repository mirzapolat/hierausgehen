'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import { cityById } from '@/lib/cities';
import { availabilityKeys, displayAvailability, sourceColor } from '@/lib/events/display';
import { clusterPlaces, groupByPlace, type Pin } from '@/lib/map';
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
 * Quellen. Was sich bei der aktuellen Zoomstufe ohnehin überdecken würde,
 * wird zusammengefasst (`lib/map.ts`) – die vier Häuser am Max-Joseph-Platz
 * sind herausgezoomt ein Punkt und hineingezoomt wieder vier.
 *
 * Zeigen genügt für einen ersten Blick: beim Überfahren steht am Zeiger, was
 * hier läuft. Ein Klick auf einen Punkt mit mehreren Terminen öffnet die
 * Ortskarte, einer mit genau einem Termin führt direkt in die Detailspalte –
 * eine Liste mit einem Eintrag ist keine Hilfe, sondern ein Zwischenschritt.
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

/** So viele Termine zeigt die Vorschau am Zeiger; der Rest wird gezählt. */
const PREVIEW_EVENTS = 6;

/** Zoomstufe beim Öffnen und immer dann, wenn es nichts einzupassen gibt. */
const START_ZOOM = 12;

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
   * Die Zoomstufe, weil das Zusammenfassen naher Punkte von ihr abhängt: was
   * herausgezoomt ein Punkt ist, sind hineingezoomt drei Häuser.
   */
  const [zoom, setZoom] = useState(START_ZOOM);
  /**
   * Der von Hand geöffnete Ort – mitsamt der Auswahl, unter der er geöffnet
   * wurde. Beides zusammen, weil zwei Wege denselben Ort öffnen: ein Klick auf
   * den Pin und die Auswahl eines Termins anderswo (Pfeiltasten, Detailspalte,
   * Suche). Wer zuletzt gehandelt hat, gewinnt – und das steht hier, statt in
   * einem Effekt, der dem anderen Zustand hinterherräumt.
   */
  const [pinned, setPinned] = useState<{ key?: string; forSelection?: string }>({});

  const places = useMemo(() => groupByPlace(events, definitions), [events, definitions]);
  const pins = useMemo(() => clusterPlaces(places, zoom), [places, zoom]);
  const unplaced = useMemo(() => events.filter((event) => !event.venue.place), [events]);
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  /** Vorschau am Zeiger: welche Nadel, an welcher Stelle der Fläche. */
  const [hover, setHover] = useState<{ pin: Pin; x: number; y: number }>();
  /** Grösse der Kartenfläche – damit die Vorschau am Rand die Seite wechselt. */
  const [size, setSize] = useState({ width: 0, height: 0 });

  /**
   * Gemerkt wird der **Ort**, nicht die Stecknadel: Nadeln entstehen je
   * Zoomstufe neu, ein Ort bleibt derselbe. Sonst verlöre ein Zoomschritt die
   * offene Ortskarte.
   */
  const selectedPlaceKey = places.find((place) =>
    place.events.some((event) => event.id === selectedEventId),
  )?.key;
  // Die Ortskarte bleibt offen, solange sich die Auswahl nicht bewegt hat.
  const openPlaceKey = pinned.forSelection === selectedEventId ? pinned.key : selectedPlaceKey;
  const active = pins.find((pin) => pin.places.some((place) => place.key === openPlaceKey));
  /**
   * Welche Nadel hervorgehoben ist. Nicht dasselbe wie die offene Ortskarte:
   * bei einem Ort mit nur einem Termin geht der Klick direkt in die
   * Detailspalte, ohne Karte – die Nadel soll trotzdem zeigen, dass sie
   * gemeint ist.
   */
  const highlighted = active ?? pins.find((pin) =>
    pin.places.some((place) => place.key === selectedPlaceKey),
  );

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
      }).setView([city.coordinates.latitude, city.coordinates.longitude], START_ZOOM);

      // Ein Klick ins Leere schliesst die Ortskarte – wie überall sonst auch.
      map.current.on('click', () => setPinned({ key: undefined }));
      map.current.on('zoomend', () => setZoom(map.current?.getZoom() ?? START_ZOOM));
      // Beim Ziehen und Zoomen wandern die Nadeln unter dem Zeiger weg.
      map.current.on('movestart zoomstart', () => setHover(undefined));

      // Die Spalten links und rechts lassen sich ziehen und einklappen;
      // Leaflet merkt das von sich aus nur beim Fenster, nicht am Element.
      observer = new ResizeObserver(([entry]) => {
        map.current?.invalidateSize({ animate: false });
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      });
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

    for (const pin of pins) {
      const marker = L.marker([pin.latitude, pin.longitude], {
        icon: L.divIcon({
          html: pinHtml(pin, pin === highlighted),
          className: 'map-pin-wrap',
          // Muss zu den Grössen in `globals.css` passen, sonst sitzt der
          // Punkt neben seinem Ort.
          iconSize: pin.events.length > 1 ? [30, 30] : [18, 18],
          iconAnchor: pin.events.length > 1 ? [15, 15] : [9, 9],
        }),
        title: `${pin.name} – ${count(pin.events.length, t)}`,
        keyboard: true,
        riseOnHover: true,
      });
      // Zwei Ereignisse in einem Aufruf verlieren die genaue Typisierung;
      // einzeln registriert bleibt `containerPoint` erhalten.
      const follow = (event: Leaflet.LeafletMouseEvent) =>
        setHover({ pin, x: event.containerPoint.x, y: event.containerPoint.y });
      marker.on('mouseover', follow);
      marker.on('mousemove', follow);
      marker.on('mouseout', () => setHover(undefined));
      marker.on('click', () => {
        // Eine Nadel mit einem einzigen Termin braucht keine Zwischenliste:
        // der Klick führt direkt in die Detailspalte. Die Auswahl steht dabei
        // schon fest, deshalb kann die Ortskarte gleich zubleiben.
        setHover(undefined);
        if (pin.events.length === 1) {
          setPinned({ key: undefined, forSelection: pin.events[0].id });
          onSelectEvent(pin.events[0]);
          return;
        }
        openPin(pin.places[0].key);
      });
      marker.addTo(map.current);
      markers.current.set(pin.key, marker);
    }
  }, [ready, pins, highlighted, openPin, onSelectEvent, t]);

  /* ------------------------------ Ausschnitt ----------------------------- */

  const zoomIn = useCallback(() => map.current?.zoomIn(), []);
  const zoomOut = useCallback(() => map.current?.zoomOut(), []);

  const fit = useCallback(
    (animate = true) => {
      const L = leaflet.current;
      if (!L || !map.current) return;
      if (places.length === 0) {
        map.current.setView([city.coordinates.latitude, city.coordinates.longitude], START_ZOOM, {
          animate,
        });
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
    if (!ready || !selectedPlaceKey || !map.current) return;
    const place = places.find((candidate) => candidate.key === selectedPlaceKey);
    if (place) map.current.panTo([place.latitude, place.longitude], { animate: true, duration: 0.4 });
  }, [ready, selectedPlaceKey, places]);

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

        {/* Vorschau am Zeiger: was hier läuft, ohne einen Klick. Bei einer
            zusammengefassten Nadel ist das die ganze Auswahl – genau dafür
            steht die Zahl darin. */}
        {hover && (
          <div
            className="map-glass pointer-events-none absolute z-[700] w-[230px] overflow-hidden
                       rounded-[14px] px-2.5 py-2"
            style={{
              // Neben dem Zeiger, und am Rand auf die andere Seite.
              left: hover.x + 246 > size.width ? undefined : hover.x + 14,
              right: hover.x + 246 > size.width ? size.width - hover.x + 14 : undefined,
              top: hover.y + 12,
              transform: hover.y + 160 > size.height ? 'translateY(calc(-100% - 26px))' : undefined,
            }}
          >
            <div className="truncate text-[11px] font-semibold" title={hover.pin.name}>
              {hover.pin.places.length === 1
                ? hover.pin.name
                : t('mapPinPlaces', { count: hover.pin.places.length })}
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {hover.pin.events.slice(0, PREVIEW_EVENTS).map((event) => (
                <li key={event.id} className="flex items-baseline gap-1.5">
                  {/* Breit genug für „Ganztägig", nicht nur für „19:30". */}
                  <span className="w-[48px] shrink-0 text-[10px] tabular-nums text-muted">
                    {event.allDay ? t('allDay') : format.time(event.start)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-[6px] w-[6px] shrink-0 rounded-full"
                    style={{ background: sourceColor(definitions, event.sourceId) }}
                  />
                  <span className="truncate text-[11px]">{event.title}</span>
                </li>
              ))}
            </ul>
            {hover.pin.events.length > PREVIEW_EVENTS && (
              <div className="mt-1 text-[10px] text-faint">
                {t('mapMore', { count: hover.pin.events.length - PREVIEW_EVENTS })}
              </div>
            )}
          </div>
        )}

        {/* Ortskarte: was an diesem Punkt läuft. */}
        {active && (
          <div
            className="map-glass absolute bottom-3 left-3 z-[600] max-h-[min(60%,340px)] w-[280px]
                       overflow-hidden rounded-[20px]"
          >
            <div className="flex items-start gap-2 px-3 py-2.5 hairline-b">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold" title={active.name}>
                  {active.places.length === 1
                    ? active.name
                    : t('mapPinPlaces', { count: active.places.length })}
                </div>
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
            <div className="max-h-[280px] overflow-y-auto scroll-quiet">
              {active.places.map((place) => (
                <section key={place.key}>
                  {/* Hält die Nadel mehrere Orte, braucht jeder seine Zeile –
                      sonst stünden die Termine ohne Zuordnung untereinander. */}
                  {active.places.length > 1 && (
                    <h3 className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.05em] text-faint">
                      {place.name}
                    </h3>
                  )}
                  <ul>
                    {place.events.map((event) => {
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
                            <span className="w-[56px] shrink-0 text-[11px] tabular-nums text-muted">
                              {event.allDay ? t('allDay') : format.time(event.start)}
                            </span>
                            <span
                              aria-hidden="true"
                              className="mt-[5px] h-[10px] w-[2px] shrink-0 rounded-full"
                              style={{ background: sourceColor(definitions, event.sourceId) }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12px] font-medium">
                                {event.title}
                              </span>
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
                </section>
              ))}
            </div>
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
                    <span className="w-[56px] shrink-0 text-[11px] tabular-nums text-muted">
                      {event.allDay ? t('allDay') : format.time(event.start)}
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
 * Der Pin. Ein einzelner Termin ist ein Punkt in der Farbe seines Ordners,
 * mehrere sind eine Scheibe mit der Anzahl und einem Ring, der die beteiligten
 * Ordner in ihren Anteilen zeigt.
 */
function pinHtml(pin: Pin, open: boolean): string {
  const state = open ? ' map-pin--open' : '';

  if (pin.events.length === 1) {
    return `<span class="map-pin map-pin--single${state}" style="--pin: ${pin.colors[0]}"></span>`;
  }

  return (
    `<span class="map-pin map-pin--group${state}" style="background: ${ring(pin.colors)}">` +
    `<span class="map-pin__count">${pin.events.length}</span></span>`
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
