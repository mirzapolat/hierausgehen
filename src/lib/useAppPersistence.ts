import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { cityById, isKnownCityId } from '@/lib/cities';
import { type CitySpacePrefs, type LayoutPrefs, readLayoutPrefs, saveLayoutPrefs, spacePrefs } from '@/lib/layoutPrefs';
import { useSettings } from '@/lib/settings/context';
import { pageTitle } from '@/lib/site';
import { type CalendarNavigation, DEFAULT_VIEW, isViewMode } from '@/lib/useCalendarNavigation';

/**
 * Was die Seite über einen Besuch hinaus behält – und was sie beim Start
 * davon zurückholt: Deeplink (`?city=&view=&date=&event=`), Spaltenbreiten
 * und die Filter jeder Stadt. Nebenbei hält sie die Adresse und den Titel im
 * Tab auf dem Stand des Kalenders.
 */
export function useAppPersistence({
  nav,
  cityId,
  initialCityId,
  layout,
  setLayout,
  restoreFilters,
  filterSpace,
  selectedTitle,
}: {
  nav: CalendarNavigation;
  cityId: string;
  initialCityId: string;
  layout: LayoutPrefs;
  setLayout: Dispatch<SetStateAction<LayoutPrefs>>;
  restoreFilters: (space: CitySpacePrefs) => void;
  filterSpace: CitySpacePrefs;
  selectedTitle?: string;
}) {
  const { settings, format, t } = useSettings();
  const { restored, restore, view, anchor, selectedEventId, setSelectedEventId } = nav;
  const [restoredSpaceCityId, setRestoredSpaceCityId] = useState<string>();

  // Deeplink und gemerkte Einstellungen lassen sich erst nach der Hydration
  // lesen – der Server kennt weder URL-Parameter des Browsers noch localStorage.
  // Deshalb hier bewusst Zustand aus einem Effekt heraus setzen, genau einmal.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const urlCity = params.get('city');
    const startupCityId = urlCity && isKnownCityId(urlCity) ? urlCity : (settings.cityId ?? initialCityId);
    const stored = readLayoutPrefs();
    const storedSpace = spacePrefs(stored, startupCityId);

    // Ein Deeplink ist eine Ansage; ohne ihn entscheidet die Breite des Geräts.
    const urlView = params.get('view');
    const startupView = isViewMode(urlView) ? urlView : DEFAULT_VIEW;

    // Die Karte bringt ihre Tagesübersicht mit – auch aus einem Deeplink heraus.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLayout(startupView === 'map' ? { ...stored, detailCollapsed: false } : stored);
    restoreFilters(storedSpace);
    setRestoredSpaceCityId(startupCityId);
    /* eslint-enable react-hooks/set-state-in-effect */

    const urlDate = params.get('date');
    // Die Stadt aus der Adresse schreibt der SettingsProvider fest – hier zählt
    // sie nur für die Filter, die zu ihr gehören.
    restore({
      view: startupView,
      day: urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) ? urlDate : format.today(),
      eventId: params.get('event') ?? undefined,
    });
    // Absichtlich nur beim Mounten – danach schreibt der Effekt unten zurück.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored) return;
    const params = new URLSearchParams();
    params.set('city', cityId);
    params.set('view', view);
    params.set('date', anchor);
    if (selectedEventId) params.set('event', selectedEventId);
    window.history.replaceState(null, '', `?${params}`);
  }, [restored, cityId, view, anchor, selectedEventId]);

  // Der Stadtwechsel lädt die Seite nicht neu; der Titel im Tab muss deshalb
  // von Hand nachziehen – in derselben Form, die der Server liefert
  // (`pageTitle`): ein offener Termin vorn, sonst die Stadt.
  useEffect(() => {
    if (!restored) return;
    document.title = pageTitle(selectedTitle ?? t('tabCity', { city: cityById(cityId).name }));
  }, [restored, cityId, selectedTitle, t]);

  // Jede Stadt hat ihre eigenen Filter; mit ihr wechseln sie.
  useEffect(() => {
    if (!restored) return;
    if (restoredSpaceCityId === cityId) return;

    restoreFilters(spacePrefs(readLayoutPrefs(), cityId));
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedEventId(undefined);
    setRestoredSpaceCityId(cityId);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [restored, restoredSpaceCityId, cityId, restoreFilters, setSelectedEventId]);

  useEffect(() => {
    if (!restored || restoredSpaceCityId !== cityId) return;
    saveLayoutPrefs(cityId, layout, filterSpace);
  }, [restored, restoredSpaceCityId, cityId, layout, filterSpace]);
}
