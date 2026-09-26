/**
 * Gemerkte Spaltenbreiten, eingeklappte Spalten und die dauerhaften Filter
 * jeder Stadt – alles in einem Eintrag in `localStorage`.
 *
 * Reine Funktionen bis auf `readLayoutPrefs` und `saveLayoutPrefs`; beide
 * schlucken Fehler, weil ein privater Modus den Kalender nicht aufhalten soll.
 */

export const LAYOUT_STORAGE_KEY = 'hierausgehen.layout.v1';

/** Dauerhafte Filter einer Stadt. */
export interface CitySpacePrefs {
  disabledSources: string[];
  availableOnly: boolean;
  disabledCategories: string[];
}

export interface LayoutPrefs {
  sidebarWidth: number;
  detailWidth: number;
  sidebarCollapsed: boolean;
  detailCollapsed: boolean;
  /** Dauerhafte Filter pro Stadt-Space. */
  spaces: Record<string, CitySpacePrefs>;
}

export const defaultSpacePrefs: CitySpacePrefs = {
  disabledSources: [],
  availableOnly: false,
  disabledCategories: [],
};

export const defaultLayout: LayoutPrefs = {
  sidebarWidth: 228,
  detailWidth: 336,
  sidebarCollapsed: false,
  detailCollapsed: false,
  spaces: {},
};

/**
 * Was im Speicher stehen kann: ältere Stände führten die Filter noch ohne
 * Stadt auf oberster Ebene.
 */
export type StoredLayoutPrefs = Partial<Omit<LayoutPrefs, 'spaces'>> &
  Partial<CitySpacePrefs> & {
    spaces?: Record<string, Partial<CitySpacePrefs>>;
  };

export function readLayoutPrefs(cityId: string): LayoutPrefs {
  try {
    return normalizeLayoutPrefs(
      JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}') as StoredLayoutPrefs,
      cityId,
    );
  } catch {
    return defaultLayout;
  }
}

/**
 * Schreibt Layout und die Filter einer Stadt zurück. Die Filter der übrigen
 * Städte bleiben, wie sie im Speicher stehen – ein anderer Tab kann sie
 * inzwischen geändert haben.
 */
export function saveLayoutPrefs(cityId: string, layout: LayoutPrefs, space: CitySpacePrefs): void {
  try {
    const current = readLayoutPrefs(cityId);
    const prefs: LayoutPrefs = {
      ...current,
      ...layout,
      spaces: { ...current.spaces, ...layout.spaces, [cityId]: space },
    };
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Privater Modus – nicht kritisch.
  }
}

/**
 * Macht aus einem beliebigen gespeicherten Stand einen gültigen. Filter aus
 * einem alten Stand ohne Städte gehören der Stadt, mit der er gelesen wird.
 */
export function normalizeLayoutPrefs(stored: StoredLayoutPrefs, cityId: string): LayoutPrefs {
  const spaces = Object.fromEntries(
    Object.entries(stored.spaces ?? {}).map(([id, prefs]) => [id, normalizeSpacePrefs(prefs)]),
  );

  if (stored.disabledSources || stored.availableOnly !== undefined || stored.disabledCategories) {
    spaces[cityId] = normalizeSpacePrefs({
      ...spaces[cityId],
      disabledSources: stored.disabledSources,
      availableOnly: stored.availableOnly,
      disabledCategories: stored.disabledCategories,
    });
  }

  return {
    ...defaultLayout,
    sidebarWidth:
      typeof stored.sidebarWidth === 'number' ? stored.sidebarWidth : defaultLayout.sidebarWidth,
    detailWidth: typeof stored.detailWidth === 'number' ? stored.detailWidth : defaultLayout.detailWidth,
    sidebarCollapsed:
      typeof stored.sidebarCollapsed === 'boolean'
        ? stored.sidebarCollapsed
        : defaultLayout.sidebarCollapsed,
    detailCollapsed:
      typeof stored.detailCollapsed === 'boolean'
        ? stored.detailCollapsed
        : defaultLayout.detailCollapsed,
    spaces,
  };
}

export function spacePrefs(layout: LayoutPrefs, cityId: string): CitySpacePrefs {
  return normalizeSpacePrefs(layout.spaces[cityId]);
}

function normalizeSpacePrefs(prefs: Partial<CitySpacePrefs> | undefined): CitySpacePrefs {
  return {
    disabledSources: stringList(prefs?.disabledSources),
    availableOnly:
      typeof prefs?.availableOnly === 'boolean' ? prefs.availableOnly : defaultSpacePrefs.availableOnly,
    disabledCategories: stringList(prefs?.disabledCategories),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
