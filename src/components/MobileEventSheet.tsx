'use client';

import { useEffect, useState } from 'react';
import type { CalendarEvent, EventPerformance, SourceDefinition } from '@/lib/events/types';
import { useSettings } from '@/lib/settings/context';
import { useOverlayTransition } from '@/lib/useOverlayTransition';
import { BottomSheet } from './BottomSheet';
import { DetailPanel } from './DetailPanel';
import { MOTION_MS } from './motion';

interface Props {
  open: boolean;
  onClose: () => void;
  event?: CalendarEvent;
  day: string;
  dayEvents: CalendarEvent[];
  definitions: SourceDefinition[];
  shareUrl: (event: CalendarEvent) => string;
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectPerformance: (performance: EventPerformance) => void;
  onBackToDay: () => void;
  revealPerformances: number;
  cityId: string;
}

/** Mobil: das Detail eines Termins als Sheet, das von unten aufsteigt. */
export function MobileEventSheet({ open, onClose, event, shareUrl, ...detail }: Props) {
  const { t } = useSettings();
  const sheet = useOverlayTransition(open && !!event, MOTION_MS);
  // Beim Zumachen darf die Auswahl schon weg sein – das Sheet zeigt trotzdem
  // bis zum Ende der Bewegung, was zuletzt darin stand.
  const [shown, setShown] = useState<CalendarEvent>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (event) setShown(event);
  }, [event]);

  if (!sheet.mounted || !shown) return null;

  return (
    <BottomSheet shown={sheet.shown} onClose={onClose} closeLabel={t('close')}>
      <DetailPanel {...detail} event={shown} shareUrl={shareUrl(shown)} inSheet />
    </BottomSheet>
  );
}
