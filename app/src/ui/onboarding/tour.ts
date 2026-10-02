import { HERO_IDS, orderedProjects, orderedWorlds, type HeroId, type Workspace } from '@quest/shared';
import { track } from '../../analytics';
import type { App } from '../../app';
import { heroStore, patchUiPrefs, reloadWithMode, uiPrefs, urlMode } from '../../config';
import { href } from '../../router';
import { HEROES } from '../../sprites/heroes';
import { parseLine, showDialogue, type Dialogue } from '../dialogue';
import { h } from '../dom';
import { modalOpen } from '../modal';
import { pickGuide, pickVariants, TOUR_LINES, TOUR_STEPS, type TourStepId } from './tour-lines';

/** Where each stop happens: the screen to show and what to spotlight there. */
interface Stop {
  title: string;
  route: (p: TourPlaces) => string;
  target: (app: App) => DOMRect | undefined;
}

/** The example level the tour walks through, chosen from whatever data is loaded. */
interface TourPlaces {
  projectId?: string;
  worldId?: string;
  levelId?: string;
}

const el = (sel: string) => () => {
  const r = document.querySelector(sel)?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? r : undefined;
};

/** The bounding box of every element matching `sel`. */
const all = (sel: string) => () => {
  const rects = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
  if (!rects.length) return;
  const x = Math.min(...rects.map((r) => r.left));
  const y = Math.min(...rects.map((r) => r.top));
  return new DOMRect(x, y, Math.max(...rects.map((r) => r.right)) - x, Math.max(...rects.map((r) => r.bottom)) - y);
};

const located = (name: string) => (app: App) => app.locators.get(name)?.();

/** The first of several ways to find a target (the desktop scene, then the phone layout). */
const first =
  (...finds: ((app: App) => DOMRect | undefined)[]) =>
  (app: App) => {
    for (const f of finds) {
      const r = f(app);
      if (r) return r;
    }
  };

const levelRoute = (p: TourPlaces) =>
  p.levelId ? href({ view: 'level', projectId: p.projectId!, worldId: p.worldId!, levelId: p.levelId }) : '#/';

const STOPS: Record<TourStepId, Stop> = {
  bedroom: { title: 'THE BEDROOM', route: () => '#/', target: first(located('cartridge'), el('.cart-floor .cart')) },
  project: { title: 'THE PROJECT MAP', route: (p) => (p.projectId ? href({ view: 'overworld', projectId: p.projectId }) : '#/'), target: first(el('.game'), el('.islands')) },
  world: { title: 'A WORLD', route: (p) => (p.worldId ? href({ view: 'world', projectId: p.projectId!, worldId: p.worldId }) : '#/'), target: first(el('.game'), el('.mobile-body .list')) },
  level: { title: 'INSIDE A LEVEL', route: levelRoute, target: first(located('qblock'), el('.strip')) },
  deps: { title: 'DEPENDENCIES', route: levelRoute, target: located('dependency') },
  flag: { title: 'THE FLAGPOLE', route: levelRoute, target: located('goal') },
  pad: { title: 'TODAY AND INBOX', route: levelRoute, target: all('.hud-today:not(.hud-review), .tab-pad') },
  play: { title: 'PLAY MODE', route: levelRoute, target: el('.nav-play') },
  ai: { title: 'YOUR AI SIDEKICK', route: levelRoute, target: el('.hud-ai') },
};

/**
 * The level to show off: the first (in map order) with a ? block and a
 * dependency, falling back to the first level there is.
 */
export function tourPlaces(ws: Workspace | undefined): TourPlaces {
  if (!ws) return {};
  let first: TourPlaces | undefined;
  for (const state of orderedProjects(ws))
    for (const world of orderedWorlds(state))
      for (const level of world.levels) {
        const place = { projectId: state.overworld.id, worldId: world.id, levelId: level.id };
        first ??= place;
        const deps = level.items.some((i) => i.type === 'dependency' && (i.subtasks?.length || i.levelRef));
        if (deps && level.items.some((i) => i.type === 'task')) return place;
      }
  return first ?? { projectId: Object.keys(ws.projects)[0] };
}

let active: { stop(): void } | undefined;

/** Starts (or resumes) the guided tour. */
export function startTour(app: App, opts: { resume?: boolean } = {}) {
  active?.stop();
  const prefs = uiPrefs();
  const resume = opts.resume && typeof prefs.tourStep === 'number' && prefs.tourStep >= 0 && HERO_IDS.includes(prefs.tourGuide as HeroId);
  let step = resume ? Math.min(prefs.tourStep!, TOUR_STEPS.length - 1) : 0;
  const picked = resume ? { guide: prefs.tourGuide as HeroId, random: !heroStore.get() } : pickGuide(HERO_IDS, heroStore.get(), prefs.tourGuide);
  const guide = picked.guide;
  const variants = resume && prefs.tourVariants?.length === TOUR_STEPS.length ? prefs.tourVariants : pickVariants(prefs.tourVariants);
  patchUiPrefs({ tourStep: step, tourGuide: guide, tourVariants: variants });
  if (!resume) track('tour_start', { guide, random: picked.random });

  // The guide walks the levels while the tour runs (never saved).
  app.heroOverride = guide;
  app.emit();

  const layer = h('div', { class: 'tour-layer' });
  const spot = h('div', { class: 'tour-spot', hidden: true });
  layer.append(spot);
  document.body.append(layer);

  let dialogue: Dialogue | undefined;
  let places = tourPlaces(app.workspace);
  let timer: ReturnType<typeof setInterval> | undefined;

  const place = () => {
    const stop = STOPS[TOUR_STEPS[step]];
    const r = stop.target(app);
    const pad = 6;
    spot.hidden = !r;
    layer.classList.toggle('no-target', !r);
    if (r) {
      spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + 2 * pad}px;height:${r.height + 2 * pad}px`;
      // Keep the box out of the spotlight's way.
      layer.classList.toggle('top', r.top + r.height / 2 > innerHeight * 0.55);
    } else layer.classList.remove('top');
  };

  const show = () => {
    const id = TOUR_STEPS[step];
    const stop = STOPS[id];
    places = tourPlaces(app.workspace);
    const route = stop.route(places);
    if (location.hash !== route) location.hash = route;
    patchUiPrefs({ tourStep: step });
    track('tour_step', { step: id });
    dialogue?.close();
    const last = step === TOUR_STEPS.length - 1;
    const button = (label: string, cls: string, run: () => void) =>
      h('button', { class: `btn sm ${cls}`, type: 'button', onclick: (e: Event) => (e.stopPropagation(), run()) }, label);
    const keep = !heroStore.get() && last;
    const footer = h(
      'div',
      { class: 'tour-bar' },
      h('div', { class: 'tour-dots', 'aria-hidden': 'true' }, TOUR_STEPS.map((_, i) => h('span', { class: i <= step ? 'on' : '' }))),
      !last && button('Skip tour', 'link tour-skip', () => end(false)),
      step > 0 && button('◀ BACK', 'tour-back', () => go(-1)),
      last
        ? [
            keep && button(`Keep ${HEROES[guide].label}`, 'tour-keep', () => {
              app.setHero(guide);
              end(true);
            }),
            button('▶ PLAY THE DEMO', 'tour-demo', () => end(true, 'demo')),
            button('★ GET STARTED', 'primary', () => end(true, 'start')),
            button('DONE', '', () => end(true)),
          ]
        : button('NEXT ▶', 'primary', () => go(1)),
    );
    dialogue = showDialogue({
      hero: guide,
      line: parseLine(TOUR_LINES[guide][id][variants[step]]),
      host: layer,
      px: innerWidth < 600 ? 2 : 3,
      instant: matchMedia('(prefers-reduced-motion: reduce)').matches,
      header: h('p', { class: 'tour-step' }, `STEP ${step + 1} OF ${TOUR_STEPS.length} · ${stop.title}`),
      footer,
      onDone: () => (last ? undefined : go(1)),
    });
    setTimeout(place, 50);
  };

  const go = (d: number) => {
    const next = step + d;
    if (next < 0 || next >= TOUR_STEPS.length) return;
    step = next;
    show();
  };

  const onKey = (e: KeyboardEvent) => {
    if (modalOpen() || (e.target as HTMLElement)?.matches?.('input, textarea, select')) return;
    const keys: Record<string, () => void> = {
      ArrowRight: () => dialogue?.advance(),
      Enter: () => dialogue?.advance(),
      ' ': () => dialogue?.advance(),
      ArrowLeft: () => go(-1),
      Escape: () => end(false),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    run();
  };

  /** Ends the tour: `finished` or skipped, optionally heading somewhere next. */
  const end = (finished: boolean, next?: 'demo' | 'start') => {
    stop();
    patchUiPrefs({ tourStep: undefined });
    track(finished ? 'tour_finish' : 'tour_skip', { step: TOUR_STEPS[step] });
    if (next === 'demo') return reloadWithMode('demo', '#/');
    if (next === 'start') {
      // The example data stays loaded under the wizard; it reloads once connected.
      return void import('./setup').then((m) => m.openSetup(app));
    }
    if (urlMode().tour) reloadWithMode(undefined, location.hash);
  };

  const stop = () => {
    clearInterval(timer);
    window.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', place);
    dialogue?.close();
    layer.remove();
    app.heroOverride = undefined;
    app.emit();
    active = undefined;
  };

  window.addEventListener('keydown', onKey, true);
  addEventListener('resize', place);
  // Scenes move things around (cameras pan, the HUD re-renders): keep the spotlight on its target.
  timer = setInterval(place, 250);
  active = { stop };
  show();
}

/** True while the tour is up. */
export const tourRunning = () => !!active;
