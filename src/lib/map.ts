import type { CalendarEvent, SourceDefinition } from './events/types.ts';
import { sourceColor } from './events/display.ts';

/**
 * Reine Rechnung für die Kartenansicht.
 *
 * Aus Terminen werden Orte, aus Orten werden Stecknadeln – beides ohne DOM,
 * ohne Leaflet und ohne Netz, damit es sich prüfen lässt. Wie ein Pin
 * *aussieht*, steht in `components/MapView.tsx`; hier steht nur, welche
 * Termine zu welchem Punkt gehören.
 */

/** Ein Ort mit allem, was an ihm an diesem Tag stattfindet. */
export interface Place {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  events: CalendarEvent[];
  /** Farben der beteiligten Quellen, in der Reihenfolge der Termine. */
  colors: string[];
}

/**
 * Eine Stecknadel auf der Karte: ein Ort – oder mehrere, die bei dieser
 * Zoomstufe ohnehin aufeinanderlägen.
 */
export interface Pin {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  places: Place[];
  events: CalendarEvent[];
  colors: string[];
}

/**
 * Näher als das dürfen sich zwei Nadeln nicht kommen, in Bildpunkten. Eine
 * Gruppennadel ist 24 px breit – darunter überdecken sie sich gegenseitig.
 */
const MERGE_DISTANCE_PX = 30;

/**
 * Termine zu Orten bündeln.
 *
 * Zusammen gehört, was denselben Punkt hat – die Räume eines Hauses fallen
 * dadurch von selbst zusammen, weil sie alle auf dessen Punkt aufgelöst
 * wurden.
 */
export function groupByPlace(events: CalendarEvent[], definitions: SourceDefinition[]): Place[] {
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
 * Orte zu Stecknadeln zusammenfassen, die bei dieser Zoomstufe zu nah
 * beieinander lägen.
 *
 * In der Altstadt stehen Nationaltheater, Residenztheater, Cuvilliés-Theater
 * und Marstall innerhalb von 200 Metern: herausgezoomt ein einziger Klumpen
 * aus vier halb verdeckten Punkten, in dem sich nichts mehr anklicken lässt.
 * Zusammengefasst wird deshalb nicht nach Entfernung in Metern, sondern nach
 * Abstand in **Bildpunkten** – das ist genau die Frage, um die es geht: decken
 * sie sich? Ein Zoomschritt weiter trennen sie sich von selbst wieder.
 *
 * Das Verfahren ist bewusst einfach (jeder Ort kommt zur ersten Nadel, die nah
 * genug liegt, sonst wird er selbst eine) und deterministisch: die Orte kommen
 * nach Anzahl der Termine sortiert an, der grösste eröffnet also die Nadel.
 */
export function clusterPlaces(places: Place[], zoom: number): Pin[] {
  const pins: Pin[] = [];

  for (const place of places) {
    const point = project(place.latitude, place.longitude, zoom);
    const near = pins.find(
      (pin) => distance(point, project(pin.latitude, pin.longitude, zoom)) <= MERGE_DISTANCE_PX,
    );

    if (!near) {
      pins.push({
        key: place.key,
        name: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
        places: [place],
        events: [...place.events],
        colors: [...place.colors],
      });
      continue;
    }

    near.places.push(place);
    near.events.push(...place.events);
    near.colors.push(...place.colors);
    // Die Nadel rückt in die Mitte ihrer Orte; auf Stadtgrösse genügt dafür
    // das Mittel der Koordinaten.
    near.latitude = mean(near.places.map((member) => member.latitude));
    near.longitude = mean(near.places.map((member) => member.longitude));
    near.key = near.places.map((member) => member.key).sort().join('+');
    near.name = near.places.map((member) => member.name).join(' · ');
  }

  for (const pin of pins) {
    pin.events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  }

  return pins;
}

/**
 * Bildpunkt eines Ortes bei dieser Zoomstufe (Web-Mercator, 256er-Kacheln) –
 * dieselbe Rechnung, die Leaflet intern anstellt, nur ohne die Karte fragen zu
 * müssen. So bleibt das Zusammenfassen eine reine Funktion und damit prüfbar.
 */
function project(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

