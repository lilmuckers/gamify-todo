export type Route =
  | { view: 'overworld' }
  | { view: 'world'; worldId: string }
  | { view: 'level'; worldId: string; levelId: string }
  | { view: 'prs' }
  | { view: 'pr'; pr: number }
  | { view: 'pr-level'; pr: number; worldId: string; levelId: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d] = parts;
  if (a === 'w' && b && c) return { view: 'level', worldId: b, levelId: c };
  if (a === 'w' && b) return { view: 'world', worldId: b };
  if (a === 'prs') return { view: 'prs' };
  if (a === 'pr' && b && Number(b) > 0) {
    if (c && d) return { view: 'pr-level', pr: Number(b), worldId: c, levelId: d };
    return { view: 'pr', pr: Number(b) };
  }
  return { view: 'overworld' };
}

export function href(route: Route): string {
  const e = encodeURIComponent;
  switch (route.view) {
    case 'overworld':
      return '#/';
    case 'world':
      return `#/w/${e(route.worldId)}`;
    case 'level':
      return `#/w/${e(route.worldId)}/${e(route.levelId)}`;
    case 'prs':
      return '#/prs';
    case 'pr':
      return `#/pr/${route.pr}`;
    case 'pr-level':
      return `#/pr/${route.pr}/${e(route.worldId)}/${e(route.levelId)}`;
  }
}

export function go(route: Route) {
  location.hash = href(route);
}

export function currentRoute(): Route {
  return parseRoute(location.hash);
}
