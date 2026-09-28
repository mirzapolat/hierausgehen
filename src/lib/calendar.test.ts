import assert from 'node:assert/strict';
import test from 'node:test';

import { clampDay, coverageRange, loadRange, navigationRange } from './calendar.ts';

test('der erhobene Zeitraum umfasst den laufenden und elf weitere Monate', () => {
  assert.deepEqual(coverageRange('2026-09-01'), { from: '2026-09-01', to: '2027-08-31' });
  assert.deepEqual(coverageRange('2026-09-30'), { from: '2026-09-01', to: '2027-08-31' });
  // Schaltjahr am Ende des Fensters.
  assert.deepEqual(coverageRange('2027-03-10'), { from: '2027-03-01', to: '2028-02-29' });
});

test('Tage ausserhalb werden an den Rand gezogen', () => {
  const range = coverageRange('2026-09-01');
  assert.equal(clampDay('2026-05-04', range), '2026-09-01');
  assert.equal(clampDay('2030-01-01', range), '2027-08-31');
  assert.equal(clampDay('2026-12-24', range), '2026-12-24');
});

test('geladen wird höchstens, was der Server vorhält', () => {
  const range = coverageRange('2026-09-01');
  assert.deepEqual(loadRange('2026-09-15', range), { from: '2026-09-01', to: '2026-10-31' });
  assert.deepEqual(loadRange('2026-12-01', range), { from: '2026-11-01', to: '2027-01-31' });
  assert.deepEqual(loadRange('2027-08-05', range), { from: '2027-07-01', to: '2027-08-31' });
});

test('zurückgeblättert wird nie in die Vergangenheit', () => {
  // Montag, 28. September 2026.
  const coverage = coverageRange('2026-09-28');
  assert.deepEqual(navigationRange('day', '2026-09-28', coverage), { from: '2026-09-28', to: '2027-08-31' });
  assert.deepEqual(navigationRange('map', '2026-09-30', coverage).from, '2026-09-30');
  // Die Woche beginnt am Montag dieser Woche, auch wenn der im Vormonat liegt.
  assert.equal(navigationRange('week', '2026-10-01', coverageRange('2026-10-01')).from, '2026-10-01');
  assert.equal(navigationRange('week', '2026-10-03', coverageRange('2026-10-03')).from, '2026-10-01');
  assert.equal(navigationRange('week', '2026-09-30', coverage).from, '2026-09-28');
  assert.equal(navigationRange('month', '2026-09-30', coverage).from, '2026-09-01');
});
