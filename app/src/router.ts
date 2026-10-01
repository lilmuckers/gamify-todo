export type Route =
  | { view: 'projects' }
  | { view: 'overworld'; projectId: string }
  | { view: 'world'; projectId: string; worldId: string }
  | { view: 'level'; projectId: string; worldId: string; levelId: string; itemId?: string }
  | { view: 'prs' }
  | { view: 'pr'; pr: number }
  | { view: 'pr-level'; pr: number; projectId: string; worldId: string; levelId: string; itemId?: string };

/**
 * Every screen has a shareable hash URL:
 *   #/                                  project select
 *   #/p/<project>                       project map
 *   #/p/<project>/<world>               world map
 *   #/p/<project>/<world>/<level>[/<item>]   level, optionally with an item's bubble open
 *   #/prs, #/pr/<n>[/<project>/<world>/<level>[/<item>]]   PR review
 */
export function parseRoute(hash: string): Route {
  const [a, b, c, d, e, f] = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (a === 'p' && b) {
    if (c && d) return { view: 'level', projectId: b, worldId: c, levelId: d, itemId: e };
    if (c) return { view: 'world', projectId: b, worldId: c };
    return { view: 'overworld', projectId: b };
  }
  if (a === 'prs') return { view: 'prs' };
  if (a === 'pr' && Number(b) > 0) {
    if (c && d && e) return { view: 'pr-level', pr: Number(b), projectId: c, worldId: d, levelId: e, itemId: f };
    return { view: 'pr', pr: Number(b) };
  }
  return { view: 'projects' };
}

export function href(route: Route): string {
  const e = encodeURIComponent;
  switch (route.view) {
    case 'projects':
      return '#/';
    case 'overworld':
      return `#/p/${e(route.projectId)}`;
    case 'world':
      return `#/p/${e(route.projectId)}/${e(route.worldId)}`;
    case 'level':
      return `#/p/${e(route.projectId)}/${e(route.worldId)}/${e(route.levelId)}${route.itemId ? `/${e(route.itemId)}` : ''}`;
    case 'prs':
      return '#/prs';
    case 'pr':
      return `#/pr/${route.pr}`;
    case 'pr-level':
      return `#/pr/${route.pr}/${e(route.projectId)}/${e(route.worldId)}/${e(route.levelId)}${route.itemId ? `/${e(route.itemId)}` : ''}`;
  }
}

export function go(route: Route) {
  location.hash = href(route);
}

export function currentRoute(): Route {
  return parseRoute(location.hash);
}

/** Project the route is inside, if any. */
export function routeProject(route: Route): string | undefined {
  return 'projectId' in route ? route.projectId : undefined;
}
