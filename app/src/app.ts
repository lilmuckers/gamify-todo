import {
  diffWorkspaces,
  findLevel,
  HERO_IDS,
  reviewLevel,
  subLevel,
  validateWorkspace,
  type GameState,
  type HeroId,
  type Issue,
  type Item,
  type Level,
  type LevelDiff,
  type OpBody,
  type PullSummary,
  type WorkspaceDiff,
  type World,
  type Workspace,
} from '@quest/shared';
import { pageView, track, type Params } from './analytics';
import { eventsForOp } from './analytics-events';
import { heroStore } from './config';
import type { PullData } from './data/source';
import type { DispatchResult, Store } from './data/store';
import { currentRoute, href, routeProject, type Route } from './router';

function selectionFrom(route: Route): Selection {
  return 'itemId' in route && route.itemId ? { kind: 'item', id: route.itemId } : undefined;
}
import { toast } from './ui/toast';

export interface PullView {
  data?: PullData;
  diff?: WorkspaceDiff;
  issues?: Issue[];
  loading: boolean;
  error?: string;
}

/** What the level view shows: a level, or a dependency's sub-level inside it. */
export interface LevelView {
  projectId: string;
  world: World;
  /** The level shown. For a sub-level, built from the dependency's subtasks (same id as its parent). */
  level: Level;
  diff?: LevelDiff;
  readonly: boolean;
  /** Set when showing a dependency's sub-level. */
  sub?: { parent: Level; dep: Item };
}

/** Where item ops in the current level view point: add to every item op. */
export function itemAddr(cur: LevelView) {
  return {
    projectId: cur.projectId,
    worldId: cur.world.id,
    levelId: cur.level.id,
    ...(cur.sub ? { parentId: cur.sub.dep.id } : {}),
  };
}

/** Which thing is selected in the level view (drives panel focus + sprite highlight). */
export type Selection = { kind: 'item'; id: string } | { kind: 'criteria' } | undefined;

/** Glue between the store, the URL and whichever UI (desktop or mobile) is mounted. */
export class App {
  route: Route = currentRoute();
  selection: Selection = selectionFrom(this.route);
  /** An item bubble is open in the level scene (Esc closes it before navigating). */
  bubbleOpen = false;
  pulls: { list?: PullSummary[]; loading: boolean; error?: string } = { loading: false };
  private pullViews = new Map<number, PullView>();
  private listeners = new Set<() => void>();

  constructor(public store: Store) {
    store.subscribe(() => this.emit());
    window.addEventListener('hashchange', () => {
      this.route = currentRoute();
      this.selection = selectionFrom(this.route);
      pageView(this.route);
      this.onRoute();
      this.emit();
    });
    this.onRoute();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  get workspace(): Workspace | undefined {
    return this.store.state;
  }

  /** Project the current route is inside. */
  get projectId(): string | undefined {
    return routeProject(this.route);
  }

  /** State of the current project (undefined on the project list or while loading). */
  get state(): GameState | undefined {
    const id = this.projectId;
    return id ? this.store.state?.projects[id] : undefined;
  }

  get caps() {
    return this.store.caps;
  }

  /** Selects an item and mirrors it in the URL (replacing history, so Back skips selections). */
  select(sel: Selection) {
    this.selection = sel;
    const r = this.route;
    if (r.view === 'level' || r.view === 'pr-level') {
      this.route = { ...r, itemId: sel?.kind === 'item' ? sel.id : undefined };
      const url = href(this.route);
      if (location.hash !== url) history.replaceState(history.state, '', url);
    }
    this.emit();
  }

  /**
   * The player character. Editable views use the repo's data/settings.json
   * (falling back to this browser's choice); read-only views let this
   * browser's choice override the repo's.
   */
  get heroId(): HeroId {
    const local = heroStore.get() as HeroId | undefined;
    const repo = this.workspace?.settings?.hero;
    const pick = this.caps.canEdit ? (repo ?? local) : (local ?? repo);
    return pick && HERO_IDS.includes(pick) ? pick : 'classic';
  }

  /** Picks a hero: saved in this browser, and in the repo's settings when editable. */
  setHero(id: HeroId) {
    heroStore.set(id);
    track('hero_select', { hero: id, saved_to_repo: this.caps.canEdit });
    if (this.caps.canEdit && this.workspace?.settings?.hero !== id) this.dispatch({ kind: 'updateSettings', patch: { hero: id } });
    this.emit();
  }

  /** Applies an edit. `meta` adds analytics context (e.g. which screen it came from). */
  dispatch(body: OpBody, meta?: Params): DispatchResult {
    const before = this.store.state;
    const r = this.store.dispatch(body);
    if (r.ok) for (const e of eventsForOp(body, before, this.store.state)) track(e.name, { ...e.params, ...meta });
    else track('edit_rejected', { reason: /no longer exists|already taken|cannot be/.test(r.error ?? '') ? 'conflict' : 'validation' });
    if (r.polish && r.polish > 0) track('polish_penalty', { points: r.polish });
    if (!r.ok) toast(r.error ?? 'Edit rejected', 'alert', 5000);
    else if (r.polish && r.polish > 0)
      toast('Perfectionism detected 🐢 — this level is already clear. Move on!', 'warn', 5000);
    return r;
  }

  private onRoute() {
    const r = this.route;
    if (r.view === 'prs') void this.loadPulls();
    if (r.view === 'pr' || r.view === 'pr-level') void this.loadPull(r.pr);
  }

  async loadPulls(force = false) {
    const provider = this.store.source.pulls;
    if (!provider || !this.caps.canReviewPRs) return;
    if (this.pulls.loading || (this.pulls.list && !force)) return;
    this.pulls = { ...this.pulls, loading: true, error: undefined };
    this.emit();
    try {
      this.pulls = { list: await provider.list(), loading: false };
    } catch (err) {
      this.pulls = { ...this.pulls, loading: false, error: (err as Error).message };
    }
    this.emit();
  }

  pullView(n: number): PullView | undefined {
    return this.pullViews.get(n);
  }

  async loadPull(n: number, force = false) {
    const provider = this.store.source.pulls;
    if (!provider || !this.caps.canReviewPRs) return;
    const existing = this.pullViews.get(n);
    if (existing && (existing.loading || (!force && existing.data))) return;
    this.pullViews.set(n, { loading: true });
    this.emit();
    try {
      const data = await provider.load(n);
      this.pullViews.set(n, {
        loading: false,
        data,
        diff: diffWorkspaces(data.base, data.head),
        issues: validateWorkspace(data.head),
      });
    } catch (err) {
      this.pullViews.set(n, { loading: false, error: (err as Error).message });
    }
    this.emit();
  }

  forgetPull(n: number) {
    this.pullViews.delete(n);
    this.pulls.list = this.pulls.list?.filter((p) => p.number !== n);
  }

  /**
   * How the level scene should arrive at the next screen (hero pops out of a
   * pipe, drops off a cloud...). Set just before navigating; read once.
   */
  arrival?: { kind: 'pipe-down' | 'pipe-up' | 'cloud'; itemId?: string };

  takeArrival() {
    const a = this.arrival;
    this.arrival = undefined;
    return a;
  }

  /** Level being viewed on the current route, with review ghosts in PR mode. */
  currentLevel(): LevelView | undefined {
    const view = this.levelView();
    const subId = (this.route.view === 'level' || this.route.view === 'pr-level') && this.route.subId;
    if (!view || !subId) return view;
    const dep = view.level.items.find((i) => i.id === subId && i.type === 'dependency');
    // A stale link to a dependency that's gone: show the level itself.
    if (!dep) return view;
    return { ...view, level: subLevel(view.level, dep), diff: undefined, sub: { parent: view.level, dep } };
  }

  private levelView(): LevelView | undefined {
    const r = this.route;
    if (r.view === 'level' && this.state) {
      const world = this.state.worlds[r.worldId];
      const level = findLevel(this.state, r.worldId, r.levelId);
      if (world && level) return { projectId: r.projectId, world, level, readonly: !this.caps.canEdit };
    }
    if (r.view === 'pr-level') {
      const v = this.pullViews.get(r.pr);
      if (!v?.data || !v.diff) return;
      const base = v.data.base.projects[r.projectId];
      const head = v.data.head.projects[r.projectId];
      const world = head?.worlds[r.worldId] ?? base?.worlds[r.worldId];
      const before = base && findLevel(base, r.worldId, r.levelId);
      const after = head && findLevel(head, r.worldId, r.levelId);
      if (!world || (!before && !after)) return;
      const diff = v.diff.levels.find(
        (l) => l.projectId === r.projectId && l.worldId === r.worldId && l.levelId === r.levelId,
      );
      return { projectId: r.projectId, world, level: reviewLevel(before, after), diff, readonly: true };
    }
  }
}
