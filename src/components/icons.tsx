/** Schlichte Strich-Icons, 16px Raster, 1.5px Strichstärke. */
type Props = { className?: string };

const base = 'h-4 w-4 shrink-0';

function Svg({ className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? base}
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: Props) => <Svg {...p}><path d="M10 3 5 8l5 5" /></Svg>;
export const ChevronRight = (p: Props) => <Svg {...p}><path d="m6 3 5 5-5 5" /></Svg>;
export const ChevronDown = (p: Props) => <Svg {...p}><path d="m3.5 6 4.5 4.5L12.5 6" /></Svg>;
export const Search = (p: Props) => (
  <Svg {...p}><circle cx="7.2" cy="7.2" r="4.2" /><path d="m10.4 10.4 3.1 3.1" /></Svg>
);
export const Close = (p: Props) => <Svg {...p}><path d="m4 4 8 8M12 4l-8 8" /></Svg>;
export const Filter = (p: Props) => (
  <Svg {...p}><path d="M2.5 4h11M4.5 8h7M6.5 12h3" /></Svg>
);
export const External = (p: Props) => (
  <Svg {...p}><path d="M6.5 3H3v10h10V9.5M9.5 2.5H13.5V6.5M13 3l-6 6" /></Svg>
);
export const CalendarPlus = (p: Props) => (
  <Svg {...p}><path d="M2.5 4.5h11v9h-11z" /><path d="M2.5 7h11M5.5 2.5v3M10.5 2.5v3M8 9v3M6.5 10.5h3" /></Svg>
);
export const Refresh = (p: Props) => (
  <Svg {...p}><path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.9" /><path d="M13.5 2v3.2h-3.2" /></Svg>
);
export const Warning = (p: Props) => (
  <Svg {...p}><path d="M8 2.5 14.5 13.5h-13z" /><path d="M8 6.5v3M8 11.5v.01" /></Svg>
);
/** Zahnrad – eigenes Raster (24), damit die Zähne sauber bleiben. */
export const Settings = ({ className }: Props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className ?? base}
  >
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
export const PanelLeft = (p: Props) => (
  <Svg {...p}><path d="M2.5 3h11v10h-11z" /><path d="M6.5 3v10" /></Svg>
);
export const PanelRight = (p: Props) => (
  <Svg {...p}><path d="M2.5 3h11v10h-11z" /><path d="M9.5 3v10" /></Svg>
);
export const Link = (p: Props) => (
  <Svg {...p}><path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.8.8" /><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.8-.8" /></Svg>
);
export const Calendar = (p: Props) => (
  <Svg {...p}><path d="M2.5 4.5h11v9h-11z" /><path d="M2.5 7h11M5.5 2.5v3M10.5 2.5v3" /></Svg>
);
export const Keyboard = (p: Props) => (
  <Svg {...p}><path d="M1.5 4.5h13v7h-13z" /><path d="M4 7v.01M6.5 7v.01M9 7v.01M11.5 7v.01M5 9.5h6" /></Svg>
);
export const Plus = (p: Props) => <Svg {...p}><path d="M8 3.5v9M3.5 8h9" /></Svg>;
export const Minus = (p: Props) => <Svg {...p}><path d="M3.5 8h9" /></Svg>;
/** Fadenkreuz – "alle Orte zeigen". */
export const Target = (p: Props) => (
  <Svg {...p}><circle cx="8" cy="8" r="4" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2" /></Svg>
);
/** Karte – die vierte Ansicht neben Tag, Woche und Monat. */
export const Map = (p: Props) => (
  <Svg {...p}>
    <path d="M1.5 4 5.5 2.5l5 2 4-1.5v9l-4 1.5-5-2-4 1.5z" />
    <path d="M5.5 2.5v9M10.5 4.5v9" />
  </Svg>
);
/** Ortsmarke – Standort und Karte. */
export const MapPin = (p: Props) => (
  <Svg {...p}>
    <path d="M8 14.5s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0c0 3.3 4.5 7.5 4.5 7.5Z" />
    <circle cx="8" cy="7" r="1.6" />
  </Svg>
);
export const Check = (p: Props) => <Svg {...p}><path d="m3 8.4 3.2 3.1L13 4.5" /></Svg>;
export const Share = (p: Props) => (
  <Svg {...p}>
    <circle cx="4" cy="8" r="1.5" />
    <circle cx="12" cy="3.5" r="1.5" />
    <circle cx="12" cy="12.5" r="1.5" />
    <path d="m5.3 7.2 5.4-3M5.3 8.8l5.4 3" />
  </Svg>
);
export const MoreHorizontal = (p: Props) => (
  <Svg {...p}>
    <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const Ticket = (p: Props) => (
  <Svg {...p}>
    <path d="M2 5.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1a1.5 1.5 0 0 0 0 3v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1a1.5 1.5 0 0 0 0-3z" />
    <path d="M9.5 4.5v1M9.5 7.5v1M9.5 10.5v1" />
  </Svg>
);
