import { useEffect, useState } from 'react';

export type Route =
  | { name: 'lists' }
  | { name: 'list'; id: string }
  | { name: 'invite'; token: string };

export function parseRoute(pathname: string): Route {
  const list = /^\/list\/([^/]+)\/?$/.exec(pathname);
  if (list?.[1]) return { name: 'list', id: decodeURIComponent(list[1]) };

  const invite = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  if (invite?.[1]) return { name: 'invite', token: decodeURIComponent(invite[1]) };

  return { name: 'lists' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return route;
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
