import { useEffect, useRef } from 'react';
import type { ViewMode } from '@/lib/calendar';
import { DETAIL_KEY, SIDEBAR_KEY, matchesKey } from '@/lib/keyboard';

export interface ShortcutHandlers {
  /** Ein offenes Menü führt seine Tastatur selbst – dann schweigen die Kürzel. */
  menuOpen: boolean;
  /** Die Kürzelübersicht lässt nur das Kürzel durch, das sie wieder zumacht. */
  shortcutsOpen: boolean;
  onEscape: () => void;
  onToggleSidebar: () => void;
  onToggleDetail: () => void;
  onStep: (direction: -1 | 1) => void;
  onStepEvent: (direction: -1 | 1) => void;
  onToday: () => void;
  onView: (view: ViewMode) => void;
  onOpenSelected: () => void;
  onSearch: () => void;
  onToggleShortcuts: () => void;
}

/**
 * Tastatur: Pfeile blättern und wählen, Buchstaben schalten Ansicht und
 * Spalten. Kürzel bleiben absichtlich einzeln und ohne Modifikator – sie
 * sollen im Kalender liegen, nicht mit denen des Browsers streiten.
 *
 * Buchstaben und `/` `?` liefert `key` auf jedem Layout richtig. Die beiden
 * Spaltenkürzel liegen dagegen auf einer Taste, deren Zeichen vom Layout
 * abhängt – die laufen über `matchesKey` und werden vor der
 * Modifikatorsperre geprüft, weil AltGr unter Windows als Strg+Alt ankommt.
 *
 * Der Zuhörer hängt einmal am Fenster und liest die Aktionen aus einem Ref;
 * so muss er nicht bei jeder Zustandsänderung neu angemeldet werden.
 */
export function useCalendarShortcuts(handlers: ShortcutHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const h = latest.current;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

      // Escape wirkt überall, auch aus dem Suchfeld heraus – aber nur für
      // sich allein, damit Tastenfolgen des Systems unberührt bleiben.
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (typing) target.blur();
        h.onEscape();
        e.preventDefault();
        return;
      }
      if (typing || h.menuOpen) return;
      if (h.shortcutsOpen && e.key !== '?') return;

      if (matchesKey(e, SIDEBAR_KEY)) {
        h.onToggleSidebar();
        e.preventDefault();
        return;
      }
      if (matchesKey(e, DETAIL_KEY)) {
        h.onToggleDetail();
        e.preventDefault();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'ArrowLeft': h.onStep(-1); break;
        case 'ArrowRight': h.onStep(1); break;
        case 'ArrowUp': h.onStepEvent(-1); break;
        case 'ArrowDown': h.onStepEvent(1); break;
        case 't': case 'T': h.onToday(); break;
        case 'd': case 'D': h.onView('day'); break;
        case 'w': case 'W': h.onView('week'); break;
        case 'm': case 'M': h.onView('month'); break;
        case 'k': case 'K': h.onView('map'); break;
        case 'o': case 'O': h.onOpenSelected(); break;
        case '/': h.onSearch(); break;
        case '?': h.onToggleShortcuts(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
