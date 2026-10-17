import type { ReactElement } from 'react';
import { useStore } from '../useStore.ts';
import { store } from '../store.ts';

/** Offline, unsaved writes, and the notices for writes that could not land. */
export function SyncBanners(): ReactElement | null {
  const view = useStore();
  const banners: ReactElement[] = [];

  if (view.offline && view.phase === 'ready') {
    banners.push(
      <div className="banner banner-offline" key="offline" data-testid="offline-banner">
        No connection — you can keep using this list. Changes go up when you’re back online.
      </div>,
    );
  }

  if (view.pending > 0 && !view.offline) {
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
