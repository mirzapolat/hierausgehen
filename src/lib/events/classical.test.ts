import assert from 'node:assert/strict';
import test from 'node:test';
import { concertKind } from './classical.ts';
import { normalizeSourceEvents } from './normalize.ts';
import type { CalendarEvent, SourceDefinition } from './types.ts';

// Titel aus den Programmen von Gasteig, MünchenMusik, HMTM, Staatsoper und Unterfahrt.
const kind = (title: string, subtitle?: string, description?: string, concerts?: 'Klassik' | 'Konzert') =>
  concertKind({ title, subtitle, description }, undefined, { concerts });

test('Gemischtes Programm: Gattung, Klangkörper, Besetzung im Titel machen Klassik', () => {
  assert.equal(kind('Bergen Filharmoniske Orkester', 'Alexander Malofeev (Klavier) & Tabita Berglund'), 'Klassik');
  assert.equal(kind('Evgeny Kissin', 'Klavierrecital'), 'Klassik');
  assert.equal(kind('Arvo-Pärt-Nacht', 'mit Vox Clamantis & Jaan-Eik Tulve (Leitung)'), 'Klassik');
  assert.equal(kind('Così fan tutte', 'Kammeroper München'), 'Klassik');
  assert.equal(kind('Budapest Festival Orchestra', 'mit Lisa Batiashvili (Violine) & Iván Fischer'), 'Klassik');
});

test('Popzeichen im Titel gewinnen – auch mit Orchester', () => {
  assert.equal(kind('Der Herr der Ringe: Die Gefährten', 'In Concert Live to Film'), 'Konzert');
  assert.equal(kind('Christmas Swing', 'David Hermlin and his Swing Dance Orchestra'), 'Konzert');
  assert.equal(kind('Chris de Burgh: It’s Never Too Late', 'Tour 2027'), 'Konzert');
  assert.equal(kind('Abba Summer Night', 'Summer Proms im Brunnenhof'), 'Konzert');
});

test('Ohne Zeichen bleibt es Konzert; die Beschreibung entscheidet nur ohne Popzeichen', () => {
  assert.equal(kind('40 Fingers'), 'Konzert');
  assert.equal(kind('Amistat', undefined, 'Werke von Brahms und Schumann'), 'Klassik');
  assert.equal(kind('Amistat', undefined, 'Brahms trifft auf Jazz'), 'Konzert');
});

test('Das Haus gibt die Richtung vor', () => {
  // Opernhaus: „Porträtkonzert“ sagt nichts, ist aber Klassik – ausser der Titel sagt Jazz.
  assert.equal(kind('Porträtkonzert', undefined, undefined, 'Klassik'), 'Klassik');
  assert.equal(kind('HSO in der Isarphilharmonie: HSO meets Jazz', undefined, undefined, 'Klassik'), 'Konzert');
  // Jazzclub: Bach in der Beschreibung macht keinen Klassikabend.
  assert.equal(kind('Jasper Høiby 3 Elements', undefined, 'klassisch ausgebildet, Bach-Bearbeitungen', 'Konzert'), 'Konzert');
});

test('Normalisierung: „Konzert“ wird zu Klassik, ohne den Wortlaut als Label zu behalten', () => {
  const definition: SourceDefinition = {
    id: 'haus',
    name: 'Haus',
    cityId: 'muenchen',
    group: 'Konzert',
    homepage: 'https://example.org',
  };
  const base: CalendarEvent = {
    id: 'haus:1',
    sourceId: 'haus',
    title: 'Sinfoniekonzert mit den Münchner Philharmonikern',
    start: '2026-11-20T20:00:00+01:00',
    allDay: false,
    venue: { name: 'Isarphilharmonie' },
    availability: 'unknown',
    url: 'https://example.org/1',
  };
  const [klassik] = normalizeSourceEvents([{ ...base, category: 'Konzert' }], definition);
  assert.equal(klassik.category, 'Klassik');
  assert.equal(klassik.categoryLabel, undefined);
  // Ein zweiter Durchlauf (Cache) ändert nichts.
  const [again] = normalizeSourceEvents([klassik], definition);
  assert.equal(again.category, 'Klassik');

  // Der Wortlaut der Quelle bleibt, wenn er mehr sagt.
  const [musik] = normalizeSourceEvents([{ ...base, category: 'Musik' }], definition);
  assert.equal(musik.category, 'Klassik');
  assert.equal(musik.categoryLabel, 'Musik');
  assert.equal(normalizeSourceEvents([musik], definition)[0].category, 'Klassik');

  // „Jazz“ als Wortlaut bleibt Konzert, auch mit Bach im Titel.
  const [jazz] = normalizeSourceEvents([{ ...base, title: 'Bach in Blue', category: 'Jazz' }], definition);
  assert.equal(jazz.category, 'Konzert');
});
