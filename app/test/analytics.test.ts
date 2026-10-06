import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOp, makeOp, type OpBody, type Workspace } from '@quest/shared';
import {
  _resetAnalytics,
  analyticsAllowed,
  bucket,
  EVENT_PARAMS,
  initAnalytics,
  routeType,
  sanitize,
  setAnalyticsAllowed,
  track,
} from '../src/analytics';
import { eventsForOp } from '../src/analytics-events';
import { href, parseRoute, type Route } from '../src/router';
import { at, level, workspace } from '../../shared/test/fixtures';

describe('sanitize', () => {
  it('keeps only allow-listed keys with short primitive values', () => {
    expect(
      sanitize(['status', 'item_type', 'count', 'flag'], {
        status: 'done',
        item_type: 'task',
        title: 'Order tiles', // not allowed
        count: 3,
        flag: false,
      }),
    ).toEqual({ status: 'done', item_type: 'task', count: 3, flag: false });
    expect(sanitize(['note'], { note: 'x'.repeat(41) })).toEqual({});
    expect(sanitize(['n'], { n: Number.NaN })).toEqual({});
  });

  it('has an allow-list for every event', () => {
    for (const keys of Object.values(EVENT_PARAMS)) expect(Array.isArray(keys)).toBe(true);
  });

  it('sends only the result of a sign-in', () => {
    expect(sanitize(EVENT_PARAMS.sign_in, { result: 'ok', login: 'octocat', repo: 'me/quests', token: 'ghu_x' } as Record<string, string>)).toEqual({ result: 'ok' });
  });

  it('sends only whether sound was turned on', () => {
    expect(sanitize(EVENT_PARAMS.sound_toggle, { on: true, hero: 'goth' })).toEqual({ on: true });
  });
});

describe('routeType', () => {
  const routes: Route[] = [
    { view: 'projects' },
    { view: 'level', projectId: 'secret-project', worldId: 'kitchen', levelId: 'demo', pad: 'today' },
    { view: 'world', projectId: 'secret-project', worldId: 'kitchen', pad: 'inbox' },
    { view: 'overworld', projectId: 'secret-project' },
    { view: 'world', projectId: 'secret-project', worldId: 'kitchen' },
    { view: 'level', projectId: 'secret-project', worldId: 'kitchen', levelId: 'demo', itemId: 'buy-tiles' },
    { view: 'level', projectId: 'secret-project', worldId: 'kitchen', levelId: 'demo', subId: 'permit' },
    { view: 'prs' },
    { view: 'pr', pr: 12 },
    { view: 'pr-level', pr: 12, projectId: 'secret-project', worldId: 'kitchen', levelId: 'demo' },
    { view: 'heroes' },
    { view: 'heroes', heroId: 'punk' },
  ];

  it('names screens without any ids', () => {
    for (const r of routes) {
      const t = routeType(r);
      expect(t).toMatch(/^\/[a-z-]+$/);
      if (r.pad) expect(t).toBe(`/${r.pad}`);
      for (const id of ['secret-project', 'kitchen', 'demo', 'buy-tiles', 'permit', '12', 'punk']) expect(t).not.toContain(id);
    }
    expect(routeType(parseRoute(href(routes[6])))).toBe('/sub-level');
  });
});

describe('bucket', () => {
  it('groups counts coarsely', () => {
    expect([0, 1, 2, 5, 6, 20, 21, 500].map(bucket)).toEqual(['0', '1', '2-5', '2-5', '6-20', '6-20', '21+', '21+']);
  });
});

describe('eventsForOp', () => {
  const run = (ws: Workspace, body: OpBody) => eventsForOp(body, ws, applyOp(ws, makeOp(body)));

  it('maps item ops to typed events with no ids or titles', () => {
    const ws = workspace();
    const events = [
      ...run(ws, { kind: 'setItemStatus', ...at, itemId: 'a', status: 'done' }),
      ...run(ws, { kind: 'addItem', ...at, item: { id: 'secret', type: 'risk', title: 'Secret title', status: 'todo' } }),
      ...run(ws, { kind: 'updateItem', ...at, itemId: 'b', patch: { title: 'Renamed secret' } }),
      ...run(ws, { kind: 'deleteItem', ...at, itemId: 'c' }),
      ...run(ws, { kind: 'setCriterion', ...at, criterionId: 'bonus', done: true }),
    ];
    expect(events.map((e) => e.name)).toEqual(['item_status', 'item_add', 'item_edit', 'item_delete', 'criterion_toggle']);
    expect(events[0].params).toMatchObject({ status: 'done', item_type: 'task', in_sub_level: false });
    expect(events[4].params).toEqual({ done: true, mvp: false });
    const sent = JSON.stringify(events.map((e) => sanitize(EVENT_PARAMS[e.name], e.params)));
    for (const leak of ['secret', 'Secret', 'Renamed', '"a"', 'bonus', 'lvl']) expect(sent).not.toContain(leak);
  });

  it('reports dependency mode and sub-level steps', () => {
    const ws = workspace(
      level({
        items: [
          { id: 'cloud', type: 'dependency', title: 'C', status: 'todo', levelRef: 'w/lvl' },
          { id: 'pipe', type: 'dependency', title: 'P', status: 'todo', subtasks: [{ id: 's', type: 'task', title: 'S', status: 'todo' }] },
        ],
      }),
    );
    expect(run(ws, { kind: 'setItemStatus', ...at, itemId: 'pipe', status: 'dropped' })[0].params).toMatchObject({ dep_mode: 'warp' });
    expect(run(ws, { kind: 'setItemStatus', ...at, parentId: 'pipe', itemId: 's', status: 'done' })[0].params).toMatchObject({
      item_type: 'task',
      in_sub_level: true,
    });
  });

  it('adds level_clear when an op clears the level', () => {
    const ws = workspace();
    const events = run(ws, { kind: 'setCriterion', ...at, criterionId: 'mvp-1', done: true });
    expect(events.map((e) => e.name)).toEqual(['criterion_toggle', 'level_clear']);
    expect(events[1].params).toMatchObject({ stars: expect.any(Number), within_timebox: expect.any(Boolean) });
  });

  it('falls back to a generic edit event with only the op kind', () => {
    expect(run(workspace(), { kind: 'updateLevel', ...at, patch: { name: 'Secret level' } })).toEqual([
      { name: 'data_edit', params: { kind: 'updateLevel' } },
    ]);
    expect(run(workspace(), { kind: 'updateSettings', patch: { hero: 'redhead' } })).toEqual([]);
  });
});

describe('loading and opt-out', () => {
  let storage: Record<string, string>;
  let appended: { src?: string }[];

  beforeEach(() => {
    storage = {};
    appended = [];
    vi.stubEnv('VITE_GA_ID', 'G-TEST');
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => (storage[k] = v),
      removeItem: (k: string) => delete storage[k],
    });
    vi.stubGlobal('location', { search: '?ga', origin: 'https://example.test', pathname: '/' });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
      createElement: () => ({}),
      head: { append: (el: { src?: string }) => appended.push(el) },
    });
    _resetAnalytics();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    _resetAnalytics();
  });

  const layer = () => ((globalThis as any).window.dataLayer ?? []).map((a: IArguments) => [...a]);

  it('loads gtag and reports a sanitised page view', () => {
    initAnalytics({ view: 'level', projectId: 'p', worldId: 'w', levelId: 'secret-level' }, { app_mode: 'readonly' });
    expect(appended[0].src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST');
    const calls = layer();
    expect(calls.find((c: unknown[]) => c[0] === 'config')).toEqual([
      'config',
      'G-TEST',
      { send_page_view: false, page_location: 'https://example.test/#/level', page_title: '/level' },
    ]);
    expect(calls.some((c: unknown[]) => c[0] === 'event' && c[1] === 'page_view')).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('secret-level');
    track('item_status', { status: 'done', title: 'leak' } as any);
    expect(layer().at(-1)).toEqual(['event', 'item_status', { status: 'done' }]);
  });

  it('loads nothing when the user opted out, and track is a no-op', () => {
    storage['quest.ui'] = JSON.stringify({ analytics: false });
    initAnalytics({ view: 'projects' }, {});
    track('pwa_install');
    expect(appended).toEqual([]);
    expect(layer()).toEqual([]);
  });

  it('defaults to off with Global Privacy Control, but an explicit choice wins', () => {
    expect(analyticsAllowed({ globalPrivacyControl: true })).toBe(false);
    expect(analyticsAllowed({})).toBe(true);
    storage['quest.ui'] = JSON.stringify({ analytics: true });
    expect(analyticsAllowed({ globalPrivacyControl: true })).toBe(true);
  });

  it('opting out stops sending at once and denies storage', () => {
    initAnalytics({ view: 'projects' }, {});
    setAnalyticsAllowed(false);
    const n = layer().length;
    track('pwa_install');
    expect(layer().length).toBe(n);
    expect(layer().some((c: unknown[]) => c[0] === 'consent')).toBe(true);
    expect(JSON.parse(storage['quest.ui'])).toEqual({ analytics: false });
  });
});
