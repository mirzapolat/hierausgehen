'use client';

import { availabilityKeys, type DisplayAvailability } from '@/lib/events/display';
import { useSettings } from '@/lib/settings/context';

const tone: Record<DisplayAvailability, string> = {
  available: 'var(--accent)',
  limited: '#C58A2E',
  soldout: 'var(--text-faint)',
  not_on_sale: 'var(--text-faint)',
  unknown: 'var(--text-faint)',
  past: 'var(--text-faint)',
  // Hingehen geht – ein Ring im Ton von „buchbar“, ohne zu behaupten, man buche.
  free: 'var(--accent)',
};

/** Kleiner Statuspunkt: gefüllt = buchbar, gedeckt = Restkarten, leer = nicht. */
export function AvailabilityDot({
  value,
  className = '',
}: {
  value: DisplayAvailability;
  className?: string;
}) {
  const { t } = useSettings();
  const color = tone[value];
  const solid = value === 'available' || value === 'limited';
  const label = t(availabilityKeys[value]);

  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${className}`}
      style={{
        background: solid ? color : 'transparent',
        boxShadow: solid ? 'none' : `inset 0 0 0 1px ${color}`,
        opacity: value === 'limited' ? 0.85 : 1,
      }}
    />
  );
}
