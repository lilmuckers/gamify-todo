import {
  diffStates,
  findLevel,
  reviewLevel,
  validateState,
  type GameState,
  type Issue,
  type Level,
  type LevelDiff,
  type OpBody,
  type PullSummary,
  type StateDiff,
  type World,
} from '@quest/shared';
import type { PullData } from './data/source';
import type { DispatchResult, Store } from './data/store';
import { currentRoute, type Route } from './router';
import { toast } from './ui/toast';

export interface PullView {
  data?: PullData;
  diff?: StateDiff;
  issues?: Issue[];
  loading: boolean;
  error?: string;
}

/** Which thing is selected in the level view (drives panel focus + sprite highlight). */
export type Selection = { kind: 'item'; id: string } | { kind: 'criteria' } | undefined;

/** Glue between the store, the URL and whichever UI (desktop or mobile) is mounted. */
export class App {
  route: Route = currentRoute();
  selection: Selection;
  pulls: { list?: PullSummary[]; loading: boolean; error?: string } = { loading: false };
  private pullViews = new Map<number, PullView>();
  private listeners = new Set<() => void>();

  constructor(public store: Store) {
    store.subscribe(() => this.emit());
    window.addEventListener('hashchange', () => {
      this.route = currentRoute();
      this.selection = undefined;
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

  get state(): GameState | undefined {
    return this.store.state;
  }

  get caps() {
    return this.store.caps;
  }

  select(sel: Selection) {
    this.selection = sel;
    this.emit();
  }

  dispatch(body: OpBody): DispatchResult {
    const r = this.store.dispatch(body);
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
        diff: diffStates(data.base, data.head),
        issues: validateState(data.head),
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

  /** Level being viewed on the current route, with review ghosts in PR mode. */
  currentLevel(): { world: World; level: Level; diff?: LevelDiff; readonly: boolean } | undefined {
    const r = this.route;
    if (r.view === 'level' && this.state) {
      const world = this.state.worlds[r.worldId];
      const level = findLevel(this.state, r.worldId, r.levelId);
      if (world && level) return { world, level, readonly: !this.caps.canEdit };
    }
    if (r.view === 'pr-level') {
      const v = this.pullViews.get(r.pr);
      if (!v?.data || !v.diff) return;
      const { base, head } = v.data;
      const world = head.worlds[r.worldId] ?? base.worlds[r.worldId];
      const before = findLevel(base, r.worldId, r.levelId);
      const after = findLevel(head, r.worldId, r.levelId);
      if (!before && !after) return;
      const level = reviewLevel(before, after);
      const diff = v.diff.levels.find((l) => l.worldId === r.worldId && l.levelId === r.levelId);
      if (world) return { world, level, diff, readonly: true };
    }
  }
}
