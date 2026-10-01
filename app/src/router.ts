type Screen =
  | { view: 'projects' }
  | { view: 'overworld'; projectId: string }
  | { view: 'world'; projectId: string; worldId: string }
  | { view: 'level'; projectId: string; worldId: string; levelId: string; subId?: string; itemId?: string }
  | { view: 'prs' }
  | { view: 'pr'; pr: number }
  | { view: 'pr-level'; pr: number; projectId: string; worldId: string; levelId: string; subId?: string; itemId?: string };

/** A page of the legal pad that can be held up over any screen. */
export type PadPage = 'today' | 'inbox' | 'review';
export const PAD_PAGES: PadPage[] = ['today', 'inbox', 'review'];

/** A screen, optionally with a page of the legal pad held up over it. */
export type Route = Screen & { pad?: PadPage };

/**
 * Every screen has a shareable hash URL:
 *   #/                                  project select
 *   #/p/<project>                       project map
 *   #/p/<project>/<world>               world map
 *   #/p/<project>/<world>/<level>[/<item>]   level, optionally with an item's bubble open
 *   #/p/<project>/<world>/<level>/@<dependency>[/<step>]   a dependency's sub-level
 *   #/prs, #/pr/<n>[/<project>/<world>/<level>[/@<dependency>][/<item>]]   PR review
 * Any of them can end in /~today, /~inbox or /~review to hold that page of
 * the legal pad up over the screen (e.g. #/~today, #/p/house/kitchen/~inbox).
 * #/today and #/review are short for #/~today and #/~review.
 */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  // "~" can't start an id; #/today and #/review open that page over the project list.
  let pad: PadPage | undefined;
  const last = parts.at(-1);
  if (last?.startsWith('~') && PAD_PAGES.includes(last.slice(1) as PadPage)) pad = parts.pop()!.slice(1) as PadPage;
  else if (parts.length === 1 && (parts[0] === 'today' || parts[0] === 'review')) pad = parts.pop() as PadPage;
  const screen = parseScreen(parts);
  return pad ? { ...screen, pad } : screen;
}

function parseScreen([a, b, ...rest]: string[]): Screen {
  // After the level: an optional "@dependency" (ids can't contain @), then an item.
  const tail = (parts: string[]) =>
    parts[0]?.startsWith('@') ? { subId: parts[0].slice(1) || undefined, itemId: parts[1] } : { itemId: parts[0] };
  if (a === 'p' && b) {
    const [c, d, ...more] = rest;
    if (c && d) return { view: 'level', projectId: b, worldId: c, levelId: d, ...tail(more) };
    if (c) return { view: 'world', projectId: b, worldId: c };
    return { view: 'overworld', projectId: b };
  }
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
  const base = screenHref(route);
  if (!route.pad) return base;
  return `${base}${base.endsWith('/') ? '' : '/'}~${route.pad}`;
}

/** The route with a pad page held up, or the pad put away (undefined). */
export function withPad(route: Route, page: PadPage | undefined): Route {
  const { pad: _, ...screen } = route;
  return page ? { ...screen, pad: page } : (screen as Route);
}

/** Holds up `page`, or puts the pad away if that page is already up. */
export function togglePad(route: Route, page: PadPage): Route {
  return withPad(route, route.pad === page ? undefined : page);
}

function screenHref(route: Screen): string {
  const e = encodeURIComponent;
  switch (route.view) {
    case 'projects':
      return '#/';
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
