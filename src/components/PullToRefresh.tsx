'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSettings } from '@/lib/settings/context';
import { Refresh } from './icons';

interface Props {
  children: ReactNode;
  disabled?: boolean;
  refreshing?: boolean;
  onRefresh: () => Promise<void> | void;
}

const THRESHOLD = 72;
const MAX_PULL = 108;
const REFRESH_PULL = 56;

interface TouchState {
  tracking: boolean;
  startX: number;
  startY: number;
  scrollEl: HTMLElement | null;
  armed: boolean;
}

const initialTouch: TouchState = {
  tracking: false,
  startX: 0,
  startY: 0,
  scrollEl: null,
  armed: false,
};

export function PullToRefresh({ children, disabled = false, refreshing = false, onRefresh }: Props) {
  const { t } = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const touch = useRef<TouchState>(initialTouch);
  const [pull, setPull] = useState(0);
  const [running, setRunning] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [armed, setArmed] = useState(false);

  const isRefreshing = refreshing || running;
  const shownPull = running ? REFRESH_PULL : pull;
  const visible = shownPull > 0 || running;
  const progress = Math.min(shownPull / THRESHOLD, 1);
  const label = isRefreshing ? t('refreshing') : armed ? t('releaseToRefresh') : t('pullToRefresh');

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reset = () => {
      touch.current = initialTouch;
      setTracking(false);
      setArmed(false);
      setPull(0);
    };

    const triggerRefresh = async () => {
      touch.current = initialTouch;
      setTracking(false);
      setArmed(false);
      setPull(REFRESH_PULL);
      setRunning(true);
      try {
        await onRefresh();
      } finally {
        setRunning(false);
        setPull(0);
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (disabled || isRefreshing || event.touches.length !== 1) return;

      const scrollEl = findScrollableAncestor(event.target, root);
      if (scrollEl && scrollEl.scrollTop > 0) return;

      const first = event.touches[0];
      touch.current = {
        tracking: true,
        startX: first.clientX,
        startY: first.clientY,
        scrollEl,
        armed: false,
      };
      setTracking(true);
    };

    const onTouchMove = (event: TouchEvent) => {
      const current = touch.current;
      if (!current.tracking || event.touches.length !== 1) return;

      const first = event.touches[0];
      const deltaX = first.clientX - current.startX;
      const deltaY = first.clientY - current.startY;

      if (deltaY <= 0) {
        setPull(0);
        return;
      }

      if (Math.abs(deltaX) > deltaY) {
        reset();
        return;
      }

      if (current.scrollEl && current.scrollEl.scrollTop > 0) {
        reset();
        return;
      }

      event.preventDefault();
      const nextPull = Math.min(MAX_PULL, Math.round(deltaY * 0.56));
      const nextArmed = nextPull >= THRESHOLD;
      current.armed = nextArmed;
      setPull(nextPull);
      setArmed(nextArmed);
    };

    const onTouchEnd = () => {
      if (!touch.current.tracking) return;
      if (touch.current.armed) void triggerRefresh();
      else reset();
    };

    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('touchend', onTouchEnd);
    root.addEventListener('touchcancel', reset);

    return () => {
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', reset);
    };
  }, [disabled, isRefreshing, onRefresh]);

  return (
    <div ref={rootRef} className="relative h-full overflow-hidden bg-[var(--canvas)]">
      <div
        aria-live="polite"
        className={`pointer-events-none absolute left-1/2 top-2 z-50 flex -translate-x-1/2 items-center gap-2
                    rounded-[var(--radius-md)] border border-line bg-[var(--raised)] px-3 py-1.5
                    text-[12px] text-muted shadow-[var(--shadow-overlay)] transition-opacity duration-150
                    ${visible ? 'opacity-100' : 'opacity-0'}`}
        style={{
          transform: `translate3d(-50%, ${Math.round(shownPull * 0.34)}px, 0)`,
        }}
      >
        <span style={{ transform: `rotate(${Math.round(progress * 180)}deg)` }}>
          <Refresh className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </span>
        <span>{label}</span>
      </div>
      <div
        className="h-full"
        style={{
          transform: `translate3d(0, ${shownPull}px, 0)`,
          transition: tracking ? 'none' : 'transform 180ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function findScrollableAncestor(target: EventTarget | null, boundary: HTMLElement): HTMLElement | null {
  let element = target instanceof Element ? target : null;

  while (element && element !== boundary) {
    if (element instanceof HTMLElement) {
      const style = window.getComputedStyle(element);
      const canScroll =
        /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;

      if (canScroll) return element;
    }
    element = element.parentElement;
  }

  return null;
}
