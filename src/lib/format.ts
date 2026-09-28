import { intlLocale, type Locale } from './i18n';
import { addDays, isDayView, isSameMonth, startOfWeek, type ViewMode } from './calendar';

/**
 * Alle sichtbaren Datums- und Zeitangaben laufen über einen `Formatter`, der
 * aus Sprache, Zeitzone und Zeitformat gebaut wird. Dadurch wirken die
 * Einstellungen an einer Stelle – nirgends steht eine feste Locale im Code.
 *
 * Reine Datumsrechnung bleibt in `calendar.ts` und arbeitet auf ISO-Tagen.
 */

export interface FormatOptions {
  locale: Locale;
  timeZone: string;
  hour12: boolean;
}

export interface Formatter extends FormatOptions {
  /** Heutiger Tag in der eingestellten Zeitzone ("YYYY-MM-DD"). */
  today: () => string;
  /** Tag eines ISO-Zeitpunkts in der eingestellten Zeitzone. */
  localDay: (iso: string) => string;
  /** Minuten seit Mitternacht in der eingestellten Zeitzone. */
  minutesOfDay: (iso: string) => number;
  dayLong: (day: string) => string;
  dayMedium: (day: string) => string;
  dayNoWeekday: (day: string) => string;
  /** Knapp mit Wochentag – "Sa., 3. Okt." – für Knöpfe. */
  dayShort: (day: string) => string;
  monthYear: (day: string) => string;
  monthYearShort: (day: string) => string;
  /** Nur der Monatsname – für enge Stellen wie den Monatswechsel im Raster. */
  monthName: (day: string) => string;
  weekdayShort: (day: string) => string;
  weekdayLong: (day: string) => string;
  dayNumber: (day: string) => string;
  time: (iso: string) => string;
  /** Stundenmarke im Zeitraster, z. B. "19:00" oder "7 PM". */
  hourLabel: (hour: number) => string;
  stamp: (iso: string) => string;
  rangeLabel: (view: ViewMode, anchor: string) => string;
  /** Dasselbe in kurz – für die Kopfzeile schmaler Geräte. */
  rangeLabelShort: (view: ViewMode, anchor: string) => string;
}

/** UTC-Mittag eines ISO-Tages – stabiler Bezugspunkt für reine Datumsformate. */
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

export function createFormatter({ locale, timeZone, hour12 }: FormatOptions): Formatter {
  const tag = intlLocale[locale];

  // Reine Datumsangaben werden in UTC formatiert: der ISO-Tag ist bereits
  // der gemeinte Tag und soll sich durch die Zeitzone nicht verschieben.
  const dateFmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(tag, { timeZone: 'UTC', ...options });

  const dayLong = dateFmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dayMedium = dateFmt({ weekday: 'short', day: 'numeric', month: 'long' });
  const dayNoWeekday = dateFmt({ day: 'numeric', month: 'long', year: 'numeric' });
  const monthYear = dateFmt({ month: 'long', year: 'numeric' });
  const monthYearShort = dateFmt({ month: 'short', year: 'numeric' });
  const monthName = dateFmt({ month: 'long' });
  const dayShort = dateFmt({ weekday: 'short', day: 'numeric', month: 'short' });
  const dayShortNoWeekday = dateFmt({ day: 'numeric', month: 'short' });
  const weekdayShort = dateFmt({ weekday: 'short' });
  const weekdayLong = dateFmt({ weekday: 'long' });

  // Zeitpunkte dagegen in der gewählten Zeitzone.
  const timeFmt = new Intl.DateTimeFormat(tag, {
    timeZone,
    hour: hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12,
  });
  const hourFmt = new Intl.DateTimeFormat(tag, {
    timeZone: 'UTC',
    hour: hour12 ? 'numeric' : '2-digit',
    minute: hour12 ? undefined : '2-digit',
    hour12,
  });
  const stampFmt = new Intl.DateTimeFormat(tag, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  });
  const isoDayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const hmFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const localDay = (iso: string) => isoDayFmt.format(new Date(iso));

  return {
    locale,
    timeZone,
    hour12,
    today: () => isoDayFmt.format(new Date()),
    localDay,
    minutesOfDay: (iso) => {
      const [h, m] = hmFmt.format(new Date(iso)).split(':').map(Number);
      return (h % 24) * 60 + m;
    },
    dayLong: (day) => dayLong.format(noon(day)),
    dayMedium: (day) => dayMedium.format(noon(day)),
    dayNoWeekday: (day) => dayNoWeekday.format(noon(day)),
    dayShort: (day) => dayShort.format(noon(day)),
    monthYear: (day) => monthYear.format(noon(day)),
    monthYearShort: (day) => monthYearShort.format(noon(day)).replace(/\./g, ''),
    monthName: (day) => monthName.format(noon(day)),
    weekdayShort: (day) => weekdayShort.format(noon(day)).replace('.', ''),
    weekdayLong: (day) => weekdayLong.format(noon(day)),
    dayNumber: (day) => String(Number(day.slice(8, 10))),
    time: (iso) => timeFmt.format(new Date(iso)),
    hourLabel: (hour) => hourFmt.format(new Date(Date.UTC(2000, 0, 1, hour % 24))),
    stamp: (iso) => stampFmt.format(new Date(iso)),
    rangeLabel: (view, anchor) => {
      if (isDayView(view)) return dayLong.format(noon(anchor));
      if (view === 'month') return monthYear.format(noon(anchor));
      const from = startOfWeek(anchor);
      const to = addDays(from, 6);
      const left = dateFmt({
        day: 'numeric',
        ...(isSameMonth(from, to) ? {} : { month: 'long' }),
      }).format(noon(from));
      const right = dayNoWeekday.format(noon(to));
      return `${left} – ${right}`;
    },
    rangeLabelShort: (view, anchor) => {
      if (isDayView(view)) return dayShort.format(noon(anchor));
      if (view === 'month') return monthYearShort.format(noon(anchor)).replace(/\./g, '');
      const from = startOfWeek(anchor);
      const to = addDays(from, 6);
      const left = dateFmt({
        day: 'numeric',
        ...(isSameMonth(from, to) ? {} : { month: 'short' }),
      }).format(noon(from));
      return `${left} – ${dayShortNoWeekday.format(noon(to))}`;
    },
  };
}
