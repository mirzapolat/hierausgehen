'use client';

import { useEffect, useRef, useState } from 'react';
import {
  addDays,
  addMonths,
  clampDay,
  endOfMonth,
  isSameMonth,
  monthGrid,
  startOfMonth,
  startOfWeek,
} from '@/lib/calendar';
import { useSettings } from '@/lib/settings/context';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from './icons';

interface Props {
  /** Der gewählte Tag – der Knopf nennt ihn, das Raster hebt ihn hervor. */
  selectedDay: string;
  /** Der Zeitraum, den der Server vorhält; alles andere ist nicht wählbar. */
  coverage: { from: string; to: string };
  onPick: (day: string) => void;
  className?: string;
}

/**
 * Sprung auf einen Tag – oben die drei Tage, nach denen am häufigsten gefragt
 * wird, darunter ein Monatsblatt für alles Weitere.
 *
 * Die Schnellwahl nennt neben „Morgen“ auch den Wochentag: wer am Donnerstag
 * „Übermorgen“ wählt, soll sehen, dass es der Samstag ist. Das Monatsblatt
 * hält sich an die Hauptansicht (heute als gefüllter Punkt) und lässt sich
 * ganz mit der Tastatur bedienen: Pfeile für Tage und Wochen, Bild auf/ab für
 * Monate, Pos1/Ende für den Wochenrand.
 */
export function DayPicker({ selectedDay, coverage, onPick, className = '' }: Props) {
  const { format, t } = useSettings();
  const [open, setOpen] = useState(false);
  /** Der Tag mit dem Tastaturfokus; bestimmt zugleich das gezeigte Monatsblatt. */
  const [cursor, setCursor] = useState(selectedDay);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const today = format.today();
  const presets = [
    { offset: 0, label: t('today') },
    { offset: 1, label: t('tomorrow') },
    { offset: 2, label: t('dayAfterTomorrowShort') },
  ].map((preset) => ({ ...preset, day: addDays(today, preset.offset) }));
  const currentPreset = presets.find((preset) => preset.day === selectedDay);

  const month = startOfMonth(cursor);
  const days = monthGrid(month);
  const canPrev = startOfMonth(addMonths(month, -1)) >= startOfMonth(coverage.from);
  const canNext = startOfMonth(addMonths(month, 1)) <= coverage.to;
  const inCoverage = (day: string) => day >= coverage.from && day <= coverage.to;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const pick = (day: string) => {
    onPick(clampDay(day, coverage));
    close(true);
  };

  // Beim Öffnen steht das Blatt auf dem gewählten Tag.
  const toggle = () => {
    if (!open) setCursor(selectedDay);
    setOpen((value) => !value);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Der Fokus folgt dem Cursor, damit die Pfeiltasten sofort wirken.
  useEffect(() => {
    if (!open) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus();
  }, [open, cursor]);

  const moveCursor = (next: string) => setCursor(clampDay(next, coverage));

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Die Kalender-Kürzel (Pfeile blättern, Escape hebt die Auswahl auf)
    // gelten hier nicht – das Blatt hat Vorrang.
    const inGrid = grid.current?.contains(e.target as Node);
    let handled = true;
    if (e.key === 'Escape') close(true);
    else if (!inGrid) handled = false;
    else if (e.key === 'ArrowLeft') moveCursor(addDays(cursor, -1));
    else if (e.key === 'ArrowRight') moveCursor(addDays(cursor, 1));
    else if (e.key === 'ArrowUp') moveCursor(addDays(cursor, -7));
    else if (e.key === 'ArrowDown') moveCursor(addDays(cursor, 7));
    else if (e.key === 'PageUp') moveCursor(addMonths(cursor, -1));
    else if (e.key === 'PageDown') moveCursor(addMonths(cursor, 1));
    else if (e.key === 'Home') moveCursor(startOfWeek(cursor));
    else if (e.key === 'End') moveCursor(addDays(startOfWeek(cursor), 6));
    else handled = false;

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const stepMonth = (direction: -1 | 1) => {
    const target = addMonths(month, direction);
    // Im neuen Monat auf demselben Tag bleiben, soweit es ihn gibt.
    const day = `${target.slice(0, 8)}${cursor.slice(8)}`;
    moveCursor(day > endOfMonth(target) ? endOfMonth(target) : day);
  };

  return (
    <div ref={container} className={`relative ${className}`} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('jumpToDay')}: ${format.dayLong(selectedDay)}`}
        title={t('jumpToDay')}
        className="flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-line px-2
                   text-[13px] text-text hover:bg-[var(--canvas)] lg:h-7 lg:text-[12px]"
      >
        <Calendar className="h-3.5 w-3.5 text-muted" />
        <span className="tabular-nums">{currentPreset?.label ?? format.dayShort(selectedDay)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-faint" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('jumpToDay')}
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-[264px] rounded-[var(--radius-md)]
                     border border-line bg-[var(--raised)] p-2"
          style={{ boxShadow: 'var(--shadow-overlay)' }}
        >
          <div className="grid grid-cols-3 gap-1">
            {presets.map((preset) => {
              const active = preset.day === selectedDay;
              return (
                <button
                  key={preset.offset}
                  type="button"
                  onClick={() => pick(preset.day)}
                  disabled={!inCoverage(preset.day)}
                  title={preset.offset === 0 ? `${preset.label} (T)` : format.dayLong(preset.day)}
                  aria-pressed={active}
                  className={`flex flex-col items-center rounded-[var(--radius-sm)] px-1 py-1.5
                              disabled:opacity-40
                              ${active ? 'bg-accent-soft text-accent' : 'text-text hover:bg-[var(--chrome)]'}`}
                >
                  <span className="text-[12px] font-medium leading-4">{preset.label}</span>
                  <span className={`text-[11px] leading-4 tabular-nums ${active ? '' : 'text-faint'}`}>
                    {format.weekdayShort(preset.day)} {format.dayNumber(preset.day)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="-mx-2 my-2 hairline-b" />

          <div className="mb-1 flex items-center justify-between pl-1.5">
            <span className="text-[12px] font-semibold" aria-live="polite">
              {format.monthYear(month)}
            </span>
            <div className="flex">
              <button
                type="button"
                onClick={() => stepMonth(-1)}
                disabled={!canPrev}
                aria-label={t('previousMonth')}
                title={t('previousMonth')}
                className="grid h-6 w-6 place-items-center rounded-[var(--radius-sm)] text-muted
                           hover:bg-[var(--chrome)] hover:text-text disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => stepMonth(1)}
                disabled={!canNext}
                aria-label={t('nextMonth')}
                title={t('nextMonth')}
                className="grid h-6 w-6 place-items-center rounded-[var(--radius-sm)] text-muted
                           hover:bg-[var(--chrome)] hover:text-text disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 text-center text-[11px] text-faint" aria-hidden>
            {days.slice(0, 7).map((day) => (
              <span key={day} className="py-1">
                {format.weekdayShort(day).slice(0, 2)}
              </span>
            ))}
          </div>

          <div ref={grid} role="grid" aria-label={format.monthYear(month)} className="grid grid-cols-7">
            {days.map((day) => {
              const outside = !isSameMonth(day, month);
              const selectable = inCoverage(day);
              const isToday = day === today;
              const isSelected = day === selectedDay;
              return (
                <button
                  key={day}
                  type="button"
                  data-day={day}
                  tabIndex={day === cursor ? 0 : -1}
                  disabled={!selectable}
                  onClick={() => pick(day)}
                  aria-label={format.dayLong(day)}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={isSelected}
                  className={`grid h-8 place-items-center rounded-[var(--radius-sm)] text-[12px] tabular-nums
                              outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]
                              disabled:pointer-events-none disabled:opacity-30
                              ${isSelected ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-[var(--chrome)]'}
                              ${!isSelected && outside ? 'text-faint' : ''}`}
                >
                  <span
                    className={`grid h-6 min-w-6 place-items-center rounded-full px-1
                                ${isToday ? 'bg-accent font-semibold text-white' : ''}`}
                  >
                    {format.dayNumber(day)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
