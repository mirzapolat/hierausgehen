'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Share } from './icons';

interface Props {
  url: string;
  label: string;
  visibleLabel?: string;
  copiedLabel: string;
  title?: string;
  iconOnly?: boolean;
  className?: string;
  umamiEvent?: string;
  umamiSource?: string;
  umamiCategory?: string;
}

/**
 * Öffnet nach Möglichkeit das Teilen-Menü des Geräts. Browser ohne
 * Web-Share-API bekommen denselben Link in die Zwischenablage gelegt.
 */
export function ShareButton({
  url,
  label,
  visibleLabel,
  copiedLabel,
  title,
  iconOnly = false,
  className,
  umamiEvent,
  umamiSource,
  umamiCategory,
}: Props) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const currentLabel = copied ? copiedLabel : label;
  const currentVisibleLabel = copied ? copiedLabel : (visibleLabel ?? label);

  const onShare = async () => {
    const absoluteUrl = new URL(url, window.location.href).toString();

    if (navigator.share) {
      try {
        await navigator.share({ title: title ?? document.title, url: absoluteUrl });
        return;
      } catch (error) {
        // Wer den Systemdialog schliesst, wollte nicht ersatzweise kopieren.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }

    if (!(await copyText(absoluteUrl))) return;
    setCopied(true);
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={() => void onShare()}
      aria-label={currentLabel}
      title={currentLabel}
      data-umami-event={umamiEvent}
      data-umami-event-source={umamiSource}
      data-umami-event-category={umamiCategory}
      className={className}
    >
      {copied ? <Check /> : <Share />}
      <span aria-live="polite" className={iconOnly ? 'sr-only' : undefined}>
        {currentVisibleLabel}
      </span>
    </button>
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Unsichere Kontexte und ältere Browser brauchen den klassischen Weg.
  }

  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
