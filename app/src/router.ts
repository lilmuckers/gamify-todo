export type Route =
  | { view: 'projects' }
  | { view: 'today' }
  | { view: 'overworld'; projectId: string }
  | { view: 'world'; projectId: string; worldId: string }
  | { view: 'level'; projectId: string; worldId: string; levelId: string; subId?: string; itemId?: string }
  | { view: 'prs' }
  | { view: 'pr'; pr: number }
  | { view: 'pr-level'; pr: number; projectId: string; worldId: string; levelId: string; subId?: string; itemId?: string };

/**
 * Every screen has a shareable hash URL:
 *   #/                                  project select
 *   #/today                             today's plan, across all projects
 *   #/p/<project>                       project map
 *   #/p/<project>/<world>               world map
 *   #/p/<project>/<world>/<level>[/<item>]   level, optionally with an item's bubble open
 *   #/p/<project>/<world>/<level>/@<dependency>[/<step>]   a dependency's sub-level
 *   #/prs, #/pr/<n>[/<project>/<world>/<level>[/@<dependency>][/<item>]]   PR review
 */
export function parseRoute(hash: string): Route {
  const [a, b, ...rest] = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  // After the level: an optional "@dependency" (ids can't contain @), then an item.
  const tail = (parts: string[]) =>
    parts[0]?.startsWith('@') ? { subId: parts[0].slice(1) || undefined, itemId: parts[1] } : { itemId: parts[0] };
  if (a === 'p' && b) {
    const [c, d, ...more] = rest;
    if (c && d) return { view: 'level', projectId: b, worldId: c, levelId: d, ...tail(more) };
    if (c) return { view: 'world', projectId: b, worldId: c };
    return { view: 'overworld', projectId: b };
  }
  if (a === 'today') return { view: 'today' };
  if (a === 'prs') return { view: 'prs' };
  if (a === 'pr' && Number(b) > 0) {
    const [c, d, e, ...more] = rest;
    if (c && d && e) return { view: 'pr-level', pr: Number(b), projectId: c, worldId: d, levelId: e, ...tail(more) };
    return { view: 'pr', pr: Number(b) };
  }
  return { view: 'projects' };
}

function levelTail(r: { subId?: string; itemId?: string }) {
  const e = encodeURIComponent;
  return `${r.subId ? `/@${e(r.subId)}` : ''}${r.itemId ? `/${e(r.itemId)}` : ''}`;
}

export function href(route: Route): string {
  const e = encodeURIComponent;
  switch (route.view) {
    case 'projects':
      return '#/';
    case 'today':
      return '#/today';
    case 'overworld':
      return `#/p/${e(route.projectId)}`;
    case 'world':
      return `#/p/${e(route.projectId)}/${e(route.worldId)}`;
    case 'level':
      return `#/p/${e(route.projectId)}/${e(route.worldId)}/${e(route.levelId)}${levelTail(route)}`;
    case 'prs':
      return '#/prs';
    case 'pr':
      return `#/pr/${route.pr}`;
    case 'pr-level':
      return `#/pr/${route.pr}/${e(route.projectId)}/${e(route.worldId)}/${e(route.levelId)}${levelTail(route)}`;
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
