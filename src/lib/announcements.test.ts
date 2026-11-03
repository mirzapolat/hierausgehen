import assert from 'node:assert/strict';
import test from 'node:test';
import { ANNOUNCEMENTS, pickAnnouncement, type Announcement } from './announcements.ts';

const text = { de: 'x', en: 'x' };
const make = (id: string, date: string, extra: Partial<Announcement> = {}): Announcement => ({
  id,
  kind: 'feature',
  date,
  title: text,
  lead: text,
  ...extra,
});

const base = { today: '2026-11-10', device: 'mobile' as const };

test('zeigt die neueste, noch nicht gesehene', () => {
  const list = [make('alt', '2026-10-01'), make('neu', '2026-11-01')];
  assert.equal(pickAnnouncement(list, { ...base, seen: new Set() })?.id, 'neu');
});

test('ist die neueste gesehen, kommen ältere nicht nach', () => {
  const list = [make('alt', '2026-10-01'), make('neu', '2026-11-01')];
  assert.equal(pickAnnouncement(list, { ...base, seen: new Set(['neu']) }), undefined);
});

test('nichts aus der Zukunft und nichts Abgelaufenes', () => {
  const list = [make('morgen', '2026-11-11'), make('vorbei', '2026-10-01', { until: '2026-11-09' })];
  assert.equal(pickAnnouncement(list, { ...base, seen: new Set() }), undefined);
});

test('der letzte Tag von `until` zählt noch', () => {
  const list = [make('heute-zuletzt', '2026-10-01', { until: '2026-11-10' })];
  assert.equal(pickAnnouncement(list, { ...base, seen: new Set() })?.id, 'heute-zuletzt');
});

test('Zielgruppe: Desktop-Ankündigungen erreichen das Telefon nicht', () => {
  const list = [make('desk', '2026-11-01', { audience: 'desktop' }), make('alle', '2026-10-01')];
  assert.equal(pickAnnouncement(list, { ...base, seen: new Set() })?.id, 'alle');
});

test('beim ersten Besuch nur, was für Neulinge gedacht ist', () => {
  const list = [make('neuerung', '2026-11-01'), make('willkommen', '2026-10-01', { forNewcomers: true })];
  assert.equal(pickAnnouncement(list, { ...base, seen: null })?.id, 'willkommen');
  assert.equal(pickAnnouncement([make('neuerung', '2026-11-01')], { ...base, seen: null }), undefined);
});

test('jede ID gibt es nur einmal, und jeder Text steht in beiden Sprachen', () => {
  const ids = ANNOUNCEMENTS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of ANNOUNCEMENTS) {
    const texts = [item.title, item.lead, ...(item.items ?? []).flatMap((entry) => [entry.title, entry.text])];
    for (const field of texts) assert.ok(field.de && field.en, `${item.id}: Text fehlt in einer Sprache`);
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});
