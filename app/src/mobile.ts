import { isWorldLocked, orderedProjects, orderedWorlds, seeded, shelfKind, suggestNext, totals, worldTotals, type GameState } from '@quest/shared';
import type { App } from './app';
import { go, href, togglePad } from './router';
import { canvasUrl, island } from './sprites/render';
import { drawStrip } from './sprites/strip';
import { heroKey } from './sprites/heroes';
import { carpetCanvas, cartridge } from './sprites/cartridge';
import { cartSpine, cobweb, spider, spineDust } from './sprites/shelf';
import { h, icon, mount } from './ui/dom';
import { renderHud, repaintSyncStatus } from './ui/hud';
import { renderPanel } from './ui/panels';
import { scheduler } from './ui/render-loop';
import { settingsDialog } from './ui/settings';
import { mountPadOverlay } from './ui/today';
import { mountRecords } from './ui/records';

/** Compact, touch-first layout for phones: DOM screens plus a static level strip. */
export function mountMobile(app: App, root: HTMLElement) {
  const hud = h('header', { class: 'hud' });
  const body = h('main', { class: 'mobile-body' });
  const nav = h('nav', { class: 'tabbar' });
  // Detailed stats takes the body's place while it's open.
  const records = h('div', { class: 'mobile' });
  root.append(hud, body, records, nav);

  const today = h('div', { class: 'mobile' });
  root.append(today);
  let stripScroll: number | undefined;
  scheduler(app, body, () => {
    renderHud(app, hud);
    renderNav(app, nav);
    const prevStrip = body.querySelector('.strip');
    if (prevStrip) stripScroll = prevStrip.scrollLeft;
    const visual = renderVisual(app, stripScroll);
    return h('div', null, visual, renderPanel(app));
  }, () => repaintSyncStatus(app, hud, body));
  window.addEventListener('hashchange', () => (stripScroll = undefined));
  mountPadOverlay(app, today);
  mountRecords(app, records, { onShow: (shown) => (body.hidden = shown) });
}

/** The shelf stays open across re-renders once it's been opened. */
let shelfOpen = false;

/** Finished and archived games, as a row of spines on a shelf under the floor: tap one to play it. */
function mobileShelf(games: GameState[]): HTMLElement | null {
  if (!games.length) return null;
  const finished = games.filter((p) => shelfKind(p) === 'finished');
  const archived = games.filter((p) => shelfKind(p) === 'archived');
  const spine = (p: GameState) => {
    const id = p.overworld.id;
    const spec = { seed: id, title: p.overworld.title, themes: orderedWorlds(p).map((w) => w.theme) };
    const dusty = shelfKind(p) === 'archived';
    return h(
      'a',
      { class: `spine${dusty ? ' dusty' : ''}`, href: href({ view: 'overworld', projectId: id }), title: p.overworld.title, 'aria-label': p.overworld.title },
      h('img', { class: 'pixel side', src: canvasUrl(cartSpine(spec, !dusty)), alt: '' }),
      dusty && h('img', { class: 'pixel dust', src: canvasUrl(spineDust(id)), alt: '' }),
      h('img', { class: 'pixel face', src: canvasUrl(cartridge(spec)), alt: '' }),
    );
  };
  const el = h(
    'details',
    { class: 'cart-shelf', open: shelfOpen },
    // Noted on click, not on 'toggle' (which fires later): a re-render in between mustn't shut it again.
    h('summary', { onclick: () => (shelfOpen = !shelfOpen) }, `The shelf: ${finished.length} completed · ${archived.length} archived`),
    h(
      'div',
      { class: 'shelf-row' },
      finished.map(spine),
      archived.length > 0 && h('i', { class: 'bookend', 'aria-hidden': 'true' }),
      archived.length > 0 &&
        h(
          'div',
          { class: 'dusty-corner' },
          h('img', { class: 'pixel web', src: canvasUrl(cobweb()), alt: '' }),
          h('img', { class: 'pixel spider', src: canvasUrl(spider(0)), alt: '' }),
          archived.map(spine),
        ),
    ),
  );
  return el;
}

function renderVisual(app: App, scroll?: number): HTMLElement | null {
  const r = app.route;
  const state = app.state;
  if (r.view === 'projects' && app.workspace) {
    const all = orderedProjects(app.workspace);
    // Cartridges on the carpet, each tilted by its own seed; finished and archived ones on the shelf.
    return h(
      'div',
      null,
      h(
        'div',
        { class: 'cart-floor', style: `background-image:url(${canvasUrl(carpetCanvas())})` },
        all.filter((p) => shelfKind(p) === 'floor').map((p) => {
          const t = totals(p);
          const id = p.overworld.id;
          const tilt = (seeded(id)() - 0.5) * 16;
          const art = cartridge({ seed: id, title: p.overworld.title, themes: orderedWorlds(p).map((w) => w.theme) });
          return h(
            'a',
            { class: 'cart', href: href({ view: 'overworld', projectId: id }), style: `--tilt:${tilt.toFixed(1)}deg` },
            h('img', { src: canvasUrl(art), class: 'pixel', alt: '' }),
            h('b', null, p.overworld.title),
            h('small', null, `★${t.stars}/${t.maxStars}`),
          );
        }),
      ),
      mobileShelf(all.filter((p) => shelfKind(p) !== 'floor')),
    );
  }
  if (r.view === 'overworld' && state) {
    const next = suggestNext(state);
    return h(
      'div',
      { class: 'islands' },
      orderedWorlds(state).map((w, i) => {
        const t = worldTotals(w);
        return h(
          'a',
          { class: 'island', href: href({ view: 'world', projectId: r.projectId, worldId: w.id }) },
          h('img', { src: canvasUrl(island(w.theme, isWorldLocked(state, w))), class: 'pixel', alt: '' }),
          h('b', null, `${i + 1}. ${w.name}`),
          h('small', null, `★${t.stars}/${t.maxStars}${next?.worldId === w.id ? ' · ▶' : ''}`),
        );
      }),
    );
  }
  const cur = app.currentLevel();
  if (cur) {
    const theme = r.view === 'pr-level' ? 'warp' : cur.sub ? 'under' : cur.world.theme;
    const sel = app.selection?.kind === 'item' ? app.selection.id : undefined;
    const strip = drawStrip(cur.level, theme, cur.diff, sel, !!cur.sub, heroKey(app.heroId));
    const scale = 1.5;
    strip.canvas.className = 'pixel';
    strip.canvas.style.width = `${strip.canvas.width * scale}px`;
    strip.canvas.style.height = `${strip.canvas.height * scale}px`;
    strip.canvas.addEventListener('click', (e) => {
      const rect = strip.canvas.getBoundingClientRect();
      const id = strip.hit((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
      app.select(id ? (sel === id ? undefined : { kind: 'item', id }) : undefined);
    });
    const wrap = h('div', { class: 'strip' }, strip.canvas);
    requestAnimationFrame(() => {
      wrap.scrollLeft = scroll ?? Math.max(0, strip.heroX * scale - wrap.clientWidth / 3);
    });
    return wrap;
  }
  return null;
}

function renderNav(app: App, nav: HTMLElement) {
  const state = app.state;
  const pid = app.projectId;
  const next = state && suggestNext(state);
  mount(
    nav,
    h('a', { href: href(togglePad(app.route, 'today')), class: `tab-pad${app.route.pad === 'today' ? ' on' : ''}` }, h('span', { class: 'gear' }, '✎'), h('span', null, 'Today')),
    h('a', { href: href(togglePad(app.route, 'inbox')), class: `tab-pad${app.route.pad === 'inbox' ? ' on' : ''}` }, h('span', { class: 'gear' }, '✉'), h('span', null, 'Inbox')),
    h('a', { href: href({ view: 'projects' }), class: app.route.view === 'projects' ? 'on' : '' }, icon('node-clear', 'grass', 'icon sm'), h('span', null, 'Projects')),
    pid &&
      h('a', { href: href({ view: 'overworld', projectId: pid }), class: app.route.view === 'overworld' ? 'on' : '' }, icon('node', 'grass', 'icon sm'), h('span', null, 'Map')),
    h(
      'button',
      { type: 'button', disabled: !next, onclick: () => next && pid && go({ view: 'level', projectId: pid, ...next }) },
      icon(heroKey(app.heroId), 'grass', 'icon sm'),
      h('span', null, 'Next'),
    ),
    app.caps.canReviewPRs &&
      h('a', { href: href({ view: 'prs' }), class: app.route.view.startsWith('pr') ? 'on' : '' }, icon('warp-pipe', 'grass', 'icon sm'), h('span', null, 'Warp')),
    h('button', { type: 'button', onclick: () => settingsDialog(app) }, h('span', { class: 'gear' }, '⚙'), h('span', null, 'Settings')),
  );
}
