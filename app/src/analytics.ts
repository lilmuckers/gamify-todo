import { setUiPrefs, uiPrefs } from './config';
import type { Route } from './router';

/**
 * Google Analytics 4 (gtag.js), loaded on the page in the Pages build only.
 *
 * Privacy rules: nothing we send contains user content (titles, ids, notes,
 * repo names, logins, tokens). Page views are reported by route type, and
 * every event parameter passes an allow-list (`sanitize`). Users can switch
 * it off in Settings → Privacy; Global Privacy Control turns it off by default.
 */

type Value = string | number | boolean;
export type Params = Record<string, Value | undefined>;

/** Allowed parameters per event. Anything else is dropped before sending. */
export const EVENT_PARAMS: Record<string, readonly string[]> = {
  item_status: ['status', 'item_type', 'in_sub_level', 'dep_mode', 'source'],
  item_add: ['item_type', 'in_sub_level'],
  item_edit: ['item_type', 'in_sub_level'],
  item_delete: ['item_type', 'in_sub_level'],
  criterion_toggle: ['done', 'mvp'],
  level_start: [],
  level_add: [],
  world_add: [],
  project_add: [],
  data_edit: ['kind'],
  level_clear: ['stars', 'within_timebox', 'polish', 'days_bucket'],
  polish_penalty: ['points'],
  timebox_warning: ['phase'],
  edit_rejected: ['reason'],
  warp_enter: ['steps_bucket', 'adding'],
  warp_exit: ['closed'],
  cloud_ride: [],
  dependency_resolve: ['action', 'dep_mode'],
  hero_select: ['hero', 'saved_to_repo'],
  nav_shortcut: ['key'],
  play_mode: ['on'],
  play_complete: ['how'],
  play_commit: ['kept', 'skipped', 'why'],
  skill_help_open: [],
  skill_download: ['format'],
  github_connect: ['can_push'],
  github_disconnect: [],
  publish: ['ok'],
  sync: ['result', 'ops_bucket'],
  sync_conflict: ['count'],
  rate_limited: [],
  pr_merge: ['method'],
  pr_review: ['event'],
  pwa_install: [],
  analytics_opt_out: [],
  undo: ['kind', 'mode'],
  inbox_add: ['item_type', 'via'],
  inbox_place: ['count', 'target'],
};

export const USER_PROPS = ['app_mode', 'layout', 'display', 'hero'] as const;

const MAX_STRING = 40;

/** Keeps only allow-listed keys with primitive, short values. */
export function sanitize(allowed: readonly string[], params: Params = {}): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const key of allowed) {
    const v = params[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string' && v.length <= MAX_STRING) out[key] = v;
  }
  return out;
}

/** Screen name for a route, with no ids in it. */
export function routeType(route: Route): string {
  if (route.pad) return `/${route.pad}`;
  switch (route.view) {
    case 'projects':
      return '/projects';
    case 'overworld':
      return '/project';
    case 'world':
      return '/world';
    case 'level':
      return route.subId ? '/sub-level' : '/level';
    case 'prs':
      return '/warp-zone';
    case 'pr':
      return '/pr';
    case 'pr-level':
      return route.subId ? '/pr-sub-level' : '/pr-level';
  }
}

/** Rounds counts into coarse buckets: 0, 1, 2-5, 6-20, 21+. */
export function bucket(n: number): string {
  if (n <= 1) return String(Math.max(0, n));
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  return '21+';
}

type Gtag = (...args: unknown[]) => void;

interface State {
  id: string;
  gtag?: Gtag;
  enabled: boolean;
}

const state: State = { id: '', enabled: false };

/** Whether the user (or their browser) allows analytics. */
export function analyticsAllowed(nav: { globalPrivacyControl?: boolean } = navigator as { globalPrivacyControl?: boolean }): boolean {
  const pref = uiPrefs().analytics;
  if (pref !== undefined) return pref;
  return !nav.globalPrivacyControl;
}

/** Measurement id for this build; dev servers need ?ga=1 to send anything. */
function measurementId(): string {
  const id = import.meta.env.VITE_GA_ID ?? '';
  if (!id) return '';
  if (import.meta.env.DEV && !new URLSearchParams(location.search).has('ga')) return '';
  return id;
}

/** Loads gtag.js (once) if this build has an id and the user allows it. */
export function initAnalytics(route: Route, props: Partial<Record<(typeof USER_PROPS)[number], string>>) {
  state.id = measurementId();
  if (!state.id || !analyticsAllowed() || state.gtag) return;
  const w = window as unknown as { dataLayer: unknown[]; gtag?: Gtag };
  w.dataLayer = w.dataLayer || [];
  // gtag.js expects the arguments object itself, as in Google's snippet.
  w.gtag = function gtag() {
    w.dataLayer.push(arguments);
  };
  state.gtag = w.gtag;
  state.enabled = true;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(state.id)}`;
  document.head.append(script);
  state.gtag('js', new Date());
  const debug = new URLSearchParams(location.search).has('ga_debug');
  state.gtag('config', state.id, {
    send_page_view: false,
    page_location: pageLocation(route),
    page_title: routeType(route),
    ...(debug ? { debug_mode: true } : {}),
  });
  setUserProps(props);
  pageView(route);
}

/** The page URL with the hash route reduced to its screen type. */
function pageLocation(route: Route): string {
  return `${location.origin}${location.pathname}#${routeType(route)}`;
}

export function track(name: keyof typeof EVENT_PARAMS, params?: Params) {
  if (!state.enabled || !state.gtag) return;
  state.gtag('event', name, sanitize(EVENT_PARAMS[name], params));
}

export function pageView(route: Route) {
  if (!state.enabled || !state.gtag) return;
  const page = { page_location: pageLocation(route), page_title: routeType(route) };
  // Automatic (enhanced measurement) events reuse these, so they never see ids either.
  state.gtag('set', page);
  state.gtag('event', 'page_view', page);
}

export function setUserProps(props: Partial<Record<(typeof USER_PROPS)[number], string>>) {
  if (!state.enabled || !state.gtag) return;
  state.gtag('set', 'user_properties', sanitize(USER_PROPS, props));
}

/** Switches analytics on or off; off takes effect at once, on after a reload. */
export function setAnalyticsAllowed(allowed: boolean) {
  if (!allowed && state.enabled && state.gtag) {
    track('analytics_opt_out');
    state.gtag('consent', 'update', { analytics_storage: 'denied' });
    state.enabled = false;
  }
  setUiPrefs({ ...uiPrefs(), analytics: allowed });
}

/** True when this build includes analytics at all (for showing the Privacy setting). */
export function analyticsAvailable(): boolean {
  return !!measurementId();
}

/** Test hook. */
export function _resetAnalytics() {
  state.id = '';
  state.gtag = undefined;
  state.enabled = false;
}
