import assert from 'node:assert/strict';
import test from 'node:test';

import { nextRefreshAt, secondsUntilRefresh, todayInZone } from './schedule.ts';

const MUC = 'Europe/Berlin';

test('vor 5 Uhr Ortszeit liegt die Erhebung noch am selben Tag', () => {
  // 01:30 Ortszeit (Winterzeit, UTC+1)
  const now = new Date('2026-01-15T00:30:00Z');
  assert.equal(nextRefreshAt(now, MUC).toISOString(), '2026-01-15T04:00:00.000Z');
});

test('nach 5 Uhr Ortszeit erst am Folgetag', () => {
  // 12:00 Ortszeit
  const now = new Date('2026-01-15T11:00:00Z');
  assert.equal(nextRefreshAt(now, MUC).toISOString(), '2026-01-16T04:00:00.000Z');
});

test('Sommerzeit verschiebt den Zeitpunkt in UTC', () => {
  // 15. Juli, Ortszeit UTC+2 – 5 Uhr Ortszeit ist 03:00 UTC.
  const now = new Date('2026-07-15T10:00:00Z');
  assert.equal(nextRefreshAt(now, MUC).toISOString(), '2026-07-16T03:00:00.000Z');
});

test('über die Zeitumstellung hinweg bleibt es 5 Uhr Ortszeit', () => {
  // Umstellung auf Sommerzeit in der Nacht zum 29. März 2026.
  const now = new Date('2026-03-28T10:00:00Z');
  const at = nextRefreshAt(now, MUC);
  assert.equal(at.toISOString(), '2026-03-29T03:00:00.000Z');
  assert.equal(
    new Intl.DateTimeFormat('en-CA', { timeZone: MUC, hourCycle: 'h23', hour: '2-digit' }).format(at),
    '05',
  );
});

test('über den Monatswechsel hinweg', () => {
  const now = new Date('2026-01-31T20:00:00Z');
  assert.equal(nextRefreshAt(now, MUC).toISOString(), '2026-02-01T04:00:00.000Z');
});

test('die Lebensdauer eines Datenstands endet bei der nächsten Erhebung', () => {
  const now = new Date('2026-01-15T00:30:00Z');
  assert.equal(secondsUntilRefresh(now, MUC), 3 * 3600 + 30 * 60);
});

test('der heutige Tag richtet sich nach der Zeitzone der Stadt', () => {
  // 23:30 UTC ist in München bereits der Folgetag.
  assert.equal(todayInZone(MUC, new Date('2026-06-30T23:30:00Z')), '2026-07-01');
  assert.equal(todayInZone(MUC, new Date('2026-06-30T12:00:00Z')), '2026-06-30');
});
