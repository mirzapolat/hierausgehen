'use client';

import { useState } from 'react';
import { groupColor } from '@/lib/events/groups';
import type { SourceDefinition } from '@/lib/events/types';

/**
 * Favicon der Quelle, mit dem Farbpunkt als Rückfallebene. Das Bild kommt vom
 * eigenen Server (`/api/source-icon/…`), nicht direkt vom Veranstalter.
 */
export function SourceIcon({ source, size = 14 }: { source: SourceDefinition; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-hidden="true"
        className="shrink-0 rounded-full"
        style={{ width: size - 6, height: size - 6, background: groupColor(source.group), margin: 3 }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/source-icon/${encodeURIComponent(source.id)}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-[2px] object-contain"
      style={{ width: size, height: size }}
    />
  );
}
