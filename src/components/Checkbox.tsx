'use client';

/** Kästchen mit drei Zuständen: aus, an, teilweise. */
export function Checkbox({
  state,
  color,
  onChange,
  label,
  className = '',
}: {
  state: 'on' | 'off' | 'mixed';
  color?: string;
  onChange: () => void;
  label: string;
  className?: string;
}) {
  const tint = color ?? 'var(--accent)';
  const filled = state !== 'off';

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      /* Das Kästchen bleibt klein, seine Trefferfläche nicht: der unsichtbare
         Rand ringsum macht daraus auf dem Finger ein Ziel von ~28 px. */
      className={`relative grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border
                  transition-colors after:absolute after:-inset-[7px] after:content-['']
                  lg:after:-inset-1 ${className}`}
      style={{
        borderColor: filled ? tint : 'var(--line-strong)',
        background: filled ? tint : 'transparent',
      }}
    >
      {state === 'on' && (
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
          <path d="M2 5.2 4 7.2 8 2.8" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === 'mixed' && <span className="h-[1.5px] w-[7px] rounded-full bg-white" />}
    </button>
  );
}
