/**
 * Läuft einmal beim Hochfahren des Servers.
 *
 * Hier startet die tägliche Erhebung der Quellen (5 Uhr Ortszeit). Ohne diesen
 * Haken würde erst der nächste Seitenaufruf nach 5 Uhr die Daten nachziehen.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { startDailyRefresh } = await import('@/lib/events/snapshot');
  startDailyRefresh();
}
