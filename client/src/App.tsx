import type { ReactElement } from 'react';
import { useRoute } from './router.ts';
import { useStore } from './useStore.ts';
import { ListView } from './views/ListView.tsx';
import { ListsView } from './views/ListsView.tsx';
import { SignInView } from './views/SignInView.tsx';
import { SignUpView } from './views/SignUpView.tsx';
import { SyncBanners } from './views/SyncBanners.tsx';

export function App(): ReactElement {
  const view = useStore();
  const route = useRoute();

  let screen: ReactElement;
  if (view.phase === 'loading') {
    screen = <p className="muted pad">Loading your lists…</p>;
  } else if (route.name === 'invite' && view.phase !== 'ready') {
    screen = <SignUpView token={route.token} />;
  } else if (view.phase === 'signed-out') {
    screen = <SignInView />;
  } else if (route.name === 'list') {
    screen = <ListView listId={route.id} />;
  } else {
    screen = <ListsView />;
  }

  return (
    <div className="app">
      <SyncBanners />
      {screen}
    </div>
  );
}
