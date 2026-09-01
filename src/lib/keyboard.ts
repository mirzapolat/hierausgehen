'use client';

import { useEffect, useState } from 'react';

/**
 * Tastenkürzel, die auf einem Satzzeichen liegen.
 *
 * Alle Kürzel der App sind einzelne Tasten ohne Modifikator – das geht auf,
 * solange es Buchstaben sind: `KeyboardEvent.key` liefert auf jedem Layout
 * denselben Buchstaben, und QWERTZ vertauscht nur Y und Z.
 *
 * Bei Satzzeichen stimmt das nicht mehr. `[` und `]` liegen auf einer
 * deutschen Tastatur gar nicht auf einer eigenen Taste: sie brauchen AltGr+8
 * bzw. AltGr+9 (Windows, Linux) oder ⌥5 bzw. ⌥6 (macOS). Damit sind sie
 * erstens kein Einzeltastenkürzel mehr, und zweitens kommt AltGr unter
 * Windows als Strg+Alt an – eine Modifikatorsperre verschluckt sie also
 * lautlos.
 *
 * Deshalb zählt hier die **Taste an ihrer Stelle** (`KeyboardEvent.code`) und
 * nicht das Zeichen, das sie erzeugt. Rechts neben dem P sitzt auf QWERTY `[`
 * und auf QWERTZ `ü` – beide ohne Modifikator, beide an derselben Stelle. Das
 * Zeichen zählt zusätzlich, damit ein zusammengesetztes `[` weiterhin wirkt.
 *
 * `/` und `?` bleiben aussen vor: die entstehen auf QWERTZ zwar über die
 * Umschalttaste (Shift+7, Shift+ß), aber `key` liefert sie unverändert.
 */
export interface KeySpec {
  /** Physische Taste – unabhängig vom Layout. */
  code: string;
  /** Zeichen, die dasselbe auslösen, egal auf welcher Taste sie liegen. */
  chars: string[];
  /** Beschriftung, solange sich das Layout nicht ermitteln lässt. */
  fallback: string;
}

/** Taste rechts neben dem P: QWERTY `[`, QWERTZ `ü`. */
export const SIDEBAR_KEY: KeySpec = { code: 'BracketLeft', chars: ['['], fallback: '[' };
/** Die Taste daneben: QWERTY `]`, QWERTZ `+`. */
export const DETAIL_KEY: KeySpec = { code: 'BracketRight', chars: [']'], fallback: ']' };

/**
 * Passt das Tastenereignis zum Kürzel?
 *
 * Zwei Wege führen hin, und beide sind nötig: die physische Taste ohne
 * Modifikator (auf jedem Layout dieselbe Stelle) und das erzeugte Zeichen
 * (auch dann, wenn erst AltGr oder die Wahltaste es hervorbringt).
 */
export function matchesKey(e: KeyboardEvent, spec: KeySpec): boolean {
  // Cmd/Windows-Taste ist nie Teil eines Kürzels der App.
  if (e.metaKey) return false;
  if (spec.chars.includes(e.key)) return true;
  return !e.ctrlKey && !e.altKey && !e.shiftKey && e.code === spec.code;
}

/**
 * Beschriftung der Taste im aktuellen Layout, für die Kürzelübersicht.
 *
 * `navigator.keyboard.getLayoutMap()` kennen bislang nur Chromium-Browser;
 * anderswo bleibt es bei `fallback`. Das Kürzel funktioniert dort trotzdem –
 * nur beschriftet ist es dann so, wie es auf QWERTY heisst.
 */
export function useKeyLabel(spec: KeySpec): string {
  const [label, setLabel] = useState(spec.fallback);

  useEffect(() => {
    let active = true;
    void readLayoutMap().then((map) => {
      const value = map?.get(spec.code);
      if (active && value) setLabel(value.toLocaleUpperCase());
    });
    return () => {
      active = false;
    };
  }, [spec]);

  return label;
}

interface KeyboardLayoutApi {
  keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> };
}

/** Einmal abfragen und behalten – das Layout wechselt nicht im Betrieb. */
let layoutMap: Promise<Map<string, string> | undefined> | undefined;

function readLayoutMap(): Promise<Map<string, string> | undefined> {
  if (layoutMap) return layoutMap;

  const api = (navigator as Navigator & KeyboardLayoutApi).keyboard;
  layoutMap = api?.getLayoutMap
    ? api.getLayoutMap().catch(() => undefined)
    : Promise.resolve(undefined);

  return layoutMap;
}
