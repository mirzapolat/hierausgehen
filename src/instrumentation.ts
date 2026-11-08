/**
 * Läuft einmal beim Hochfahren des Servers.
 *
 * Hier startet die tägliche Erhebung der Quellen (5 Uhr Ortszeit). Ohne diesen
 * Haken würde erst der nächste Seitenaufruf nach 5 Uhr die Daten nachziehen.
 *
 * Danach baut die Suche ihre Indizes und bettet ein, was noch keinen Vektor
 * hat – im Hintergrund, die Seite ist schon vorher da. Alle halbe Stunde
 * schaut sie nach, ob sich ein Datenstand geändert hat (Erhebung, nachgeholte
 * Quelle); ohne Änderung kostet das nichts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { startDailyRefresh } = await import('@/lib/events/snapshot');
  startDailyRefresh();

  const { warmSearch } = await import('@/lib/search/service');
  const { servedCities } = await import('@/lib/site-metadata');
  const cityIds = servedCities.map((city) => city.id);
  const warm = () => {
    warmSearch(cityIds).catch((error) => console.warn('[search] Aufwärmen fehlgeschlagen', error));
  };
  // Erst die Erhebung anlaufen lassen; die Suche braucht ihren Stand.
  setTimeout(warm, 5_000).unref?.();
  setInterval(warm, 30 * 60 * 1000).unref?.();
}
