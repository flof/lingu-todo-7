import { useEffect, useState, type ReactElement } from 'react';
import { useStore } from '../useStore.ts';
import { store } from '../store.ts';

/**
 * How long a change must be outstanding before we admit it is still going up.
 * A write on a normal connection lands in a blink, and a bar that appears and
 * disappears within a frame reads as a glitch — so we only speak up once the
 * change has really been waiting.
 */
const QUIET_MS = 1500;

/** True only once `active` has held for `delayMs`; false again the moment it drops. */
function useSteady(active: boolean, delayMs: number): boolean {
  const [steady, setSteady] = useState(false);

  useEffect(() => {
    if (!active) {
      setSteady(false);
      return;
    }
    const timer = window.setTimeout(() => setSteady(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return steady;
}

/** Offline, unsaved writes, and the notices for writes that could not land. */
export function SyncBanners(): ReactElement | null {
  const view = useStore();
  const banners: ReactElement[] = [];

  // Checking an item, tapping +, adding a line — all of them can flash this
  // banner for a few milliseconds. Waiting keeps it off the screen unless a
  // change is genuinely stuck.
  const showPending = useSteady(view.pending > 0 && !view.offline, QUIET_MS);

  if (view.offline && view.phase === 'ready') {
    banners.push(
      <div className="banner banner-offline" key="offline" data-testid="offline-banner">
        No connection — you can keep using this list. Changes go up when you’re back online.
      </div>,
    );
  }

  if (showPending) {
    banners.push(
      <div className="banner banner-pending" key="pending" data-testid="pending-writes">
        {view.pending === 1 ? '1 change is' : `${view.pending} changes are`} still going up…
      </div>,
    );
  }

  for (const notice of view.notices) {
    banners.push(
      <div className="banner banner-notice" key={notice.id} data-testid="notice" role="status">
        <span>{notice.text}</span>
        <button type="button" className="bare" onClick={() => store.dismissNotice(notice.id)}>
          Dismiss
        </button>
      </div>,
    );
  }

  return banners.length > 0 ? <div className="banners">{banners}</div> : null;
}
