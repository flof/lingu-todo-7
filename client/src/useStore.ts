import { useSyncExternalStore } from 'react';
import { store, type View } from './store.ts';

export function useStore(): View {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
