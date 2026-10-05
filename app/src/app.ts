import {
  alertText,
  budgetAlerts,
  budgetPrefs,
  diffWorkspaces,
  findLevel,
  findLevelAt,
  HERO_IDS,
  inverseOp,
  isReviewDue,
  UNDOABLE,
  reviewLevel,
  subLevel,
  validateWorkspace,
  type BudgetPrefs,
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
  type Op,
  type Workspace,
} from '@quest/shared';
import { pageView, track, type Params } from './analytics';
import { eventsForOp } from './analytics-events';
import { play as sfx } from './audio';
import { heroStore, patchUiPrefs, reviewStore, uiPrefs, type ReviewPrefs } from './config';
import { pullLookup, type PullData } from './data/source';
import type { DispatchResult, Store } from './data/store';
import { ProgressHistory } from './data/history';
import { browserKV } from './data/kv';
import { currentRoute, href, routeProject, type Route } from './router';
import { sceneShows, soundForOp } from './sound-events';
import { playSummary } from './ui/play-summary';

/**
 * What an emit may have changed: anything, or only the sync status (the HUD
 * pill and the panel's sync footer). Views that show no sync status can
 * ignore 'sync'.
 */
export type Change = 'all' | 'sync';

/** Why a play session ended: shapes the summary's wording. */
export type PlayEnd = 'stopped' | 'idle' | 'cleared' | 'left' | 'resumed';

function selectionFrom(route: Route): Selection {
  return 'itemId' in route && route.itemId ? { kind: 'item', id: route.itemId } : undefined;
}
import { truncate } from './ui/dom';
import { toast, undoToast } from './ui/toast';

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
  /** The project's budget settings; undefined when it doesn't track money. */
  budgets?: BudgetPrefs;
  /** Set when showing a dependency's sub-level. */
  sub?: { parent: Level; dep: Item };
}

/** Edits that can change what's budgeted or spent. */
const MONEY_OPS = new Set<OpBody['kind']>(['addItem', 'updateItem', 'updateLevel', 'updateWorld']);

/** Where item ops in the current level view point: add to every item op. */
export function itemAddr(cur: LevelView) {
  return {
    projectId: cur.projectId,
    worldId: cur.world.id,
    levelId: cur.level.id,
    ...(cur.sub ? { parentId: cur.sub.dep.id } : {}),
  };
}

/** Short toast text for an undoable edit, named by the item it touched. */
function undoLabel(op: Op, before: Workspace): string {
  const short = (t: string) => truncate(t, 32);
  const idea = (id: string) => short(before.inbox?.find((i) => i.id === id)?.title ?? id);
  if (op.kind === 'inboxAdd') return `Jotted down: ${short(op.item.title)}`;
  if (op.kind === 'inboxUpdate') return `Edited: ${idea(op.id)}`;
  if (op.kind === 'inboxRemove') return `Crossed out: ${idea(op.ids[0])}`;
  if (!('levelId' in op) || !('worldId' in op)) return 'Edited';
  const state = before.projects[op.projectId];
  const level = state && findLevel(state, op.worldId, op.levelId);
  const parentId = 'parentId' in op ? op.parentId : undefined;
  const list = parentId ? (level?.items.find((i) => i.id === parentId)?.subtasks ?? []) : (level?.items ?? []);
  const title = (id: string) => list.find((i) => i.id === id)?.title ?? id;
  switch (op.kind) {
    case 'setItemStatus':
      return `${STATUS_WORD[op.status]}: ${short(title(op.itemId))}`;
    case 'setCriterion':
      return op.done ? 'Criterion ticked' : 'Criterion unticked';
    case 'updateItem':
      return `Edited: ${short(title(op.itemId))}`;
    case 'addItem':
      return `Added: ${short(op.item.title)}`;
    case 'deleteItem':
      return `Deleted: ${short(title(op.itemId))}`;
    default:
      return 'Edited';
  }
}

/** Why an edit was refused, for analytics: it clashed with other data, or failed validation. */
function rejectReason(error?: string): 'conflict' | 'validation' {
  return /no longer exists|already taken|cannot be|can't/.test(error ?? '') ? 'conflict' : 'validation';
}

const STATUS_WORD: Record<string, string> = { todo: 'Reopened', doing: 'Started', done: 'Done', dropped: 'Dropped' };

/** Which thing is selected in the level view (drives panel focus + sprite highlight). */
export type Selection = { kind: 'item'; id: string } | { kind: 'criteria' } | undefined;

/** Glue between the store, the URL and whichever UI (desktop or mobile) is mounted. */
export class App {
  route: Route = currentRoute();
  /** The compact mobile view: no level scene, so edits make their own sounds. */
  compact = false;
  selection: Selection = selectionFrom(this.route);
  /** An item bubble is open in the level scene (Esc closes it before navigating). */
  bubbleOpen = false;
  /** Play mode: the hero is driven by gamepad or keyboard instead of walking himself. */
  playing = false;
  /** Next time the inbox page renders, put the cursor in its scribble line. */
  focusCapture = false;
  /** The tour's guide, standing in for the player's hero while it runs (never saved). */
  heroOverride?: HeroId;
  /**
   * Where things are on screen, by name ('cartridge', 'qblock', 'goal'...),
   * registered by whichever scene shows them, for the tour's spotlight.
   */
  locators = new Map<string, () => DOMRect | undefined>();
  /** Little show-and-tell animations for the tour, by the same names (no data changes). */
  demos = new Map<string, () => Promise<void>>();
  pulls: { list?: PullSummary[]; loading: boolean; error?: string } = { loading: false };
  private pullViews = new Map<number, PullView>();
  private listeners = new Set<(change: Change) => void>();
  /** What the last store emit showed, to tell data changes from sync-status ones. */
  private seen: { state?: Workspace; caps: string } = { caps: '' };

  /** What the commit history adds to the stats: work done and later undone. */
  progress: ProgressHistory;

  constructor(public store: Store) {
    store.subscribe(() => this.emit(this.storeChange()));
    this.progress = new ProgressHistory(store.source, browserKV(), () => this.emit());
    void this.progress.init();
    window.addEventListener('hashchange', () => {
      this.route = currentRoute();
      this.selection = selectionFrom(this.route);
      // The cloud home waits in the level it went to (and its sub-levels); anywhere else it's gone.
      const t = this.cloudTrip;
      const r = this.route;
      if (t && !(r.view === 'level' && r.projectId === t.projectId && r.worldId === t.to.worldId && r.levelId === t.to.levelId)) this.cloudTrip = undefined;
      // Warping or riding a cloud keeps playing; leaving the levels stops.
      if (!this.canPlay && this.playing) this.endPlay('left');
      pageView(this.route);
      this.onRoute();
      this.emit();
    });
    this.onRoute();
    // Closing the tab mid-session: the browser asks; next load shows the summary.
    window.addEventListener('beforeunload', (e) => {
      if (!this.store.held.size) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  /** Play mode is for levels (not PR review) with no pad page held up. */
  get canPlay() {
    return this.route.view === 'level' && !this.route.pad;
  }

  /**
   * Starts or ends play mode. While playing, edits are held back from syncing;
   * ending shows what changed and asks which to commit.
   */
  setPlaying(on: boolean, why: PlayEnd = 'stopped') {
    on &&= this.canPlay;
    if (on === this.playing) return;
    if (on) {
      this.playing = true;
      this.store.hold(true);
    } else this.endPlay(why);
    sfx(on ? 'playOn' : 'playOff');
    this.emit();
  }

  private endPlay(why: PlayEnd) {
    this.playing = false;
    this.store.hold(false);
    this.reviewHeld(why);
  }

  /** Asks which held play-session edits to commit (nothing held: just carries on syncing). */
  reviewHeld(why: PlayEnd) {
    const ops = this.store.heldOps();
    if (!ops.length) this.store.release([]);
    else playSummary(this, ops, why);
  }

  subscribe(fn: (change: Change) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(change: Change = 'all') {
    for (const fn of this.listeners) fn(change);
  }

  /**
   * A store emit that kept the same state object (the store reuses it when a
   * sync changes nothing) and the same capabilities only moved sync status.
   * While loading (no state yet) the panel shows the store's error: 'all'.
   */
  private storeChange(): Change {
    const { state, caps } = this.store;
    const sig = `${caps.canEdit}${caps.canReviewPRs}${caps.canPublish}`;
    const change: Change = state && state === this.seen.state && sig === this.seen.caps ? 'sync' : 'all';
    this.seen = { state, caps: sig };
    return change;
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
    if (this.heroOverride) return this.heroOverride;
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
    if (r.ok && r.op && before && !meta?.undo && UNDOABLE.has(r.op.kind)) this.offerUndo(r.op, before);
    if (!r.ok) track('edit_rejected', { reason: rejectReason(r.error) });
    if (r.polish && r.polish > 0) track('polish_penalty', { points: r.polish });
    if (!r.ok) {
      sfx('buzz');
      toast(r.error ?? 'Edit rejected', 'alert', 5000);
    } else if (r.polish && r.polish > 0) {
      sfx('polish');
      toast('Perfectionism detected 🐢 — this level is already clear. Move on!', 'warn', 5000);
    } else if (!meta?.undo && (this.compact || !sceneShows(this.route, body))) {
      const sound = soundForOp(body, before, this.store.state);
      if (sound) sfx(sound);
    }
    if (r.ok && before && !meta?.undo) this.alertBudgets(body, before);
    return r;
  }

  /** A toast when an edit takes something past its heads-up point or over budget (if the project wants alerts). */
  private alertBudgets(body: OpBody, before: Workspace) {
    if (!MONEY_OPS.has(body.kind) || !('projectId' in body)) return;
    const prev = before.projects[body.projectId];
    const next = this.store.state?.projects[body.projectId];
    const prefs = budgetPrefs(next);
    if (!prev || !next || !prefs?.alerts) return;
    const alerts = budgetAlerts(prev, next, prefs.alertAt);
    if (!alerts.length) return;
    // The most specific few: the thing itself, then what it tipped over.
    const lines = alerts.slice(0, 3).map((a) => alertText(a, prefs.currency));
    sfx('budget');
    toast(`💰 ${lines.join(' ')}`, alerts.some((a) => a.level === 2) ? 'alert' : 'warn', 7000);
  }

  /**
   * Applies several edits together (all or none), so they sync as one
   * commit. No undo toast: these are deliberate scope cuts.
   */
  dispatchBatch(bodies: OpBody[], meta?: Params): boolean {
    const before = this.store.state;
    const r = this.store.dispatchBatch(bodies);
    if (!r.ok) {
      track('edit_rejected', { reason: rejectReason(r.error) });
      sfx('buzz');
      toast(r.error ?? 'Edit rejected', 'alert', 5000);
      return false;
    }
    for (const body of bodies) for (const e of eventsForOp(body, before, this.store.state)) track(e.name, { ...e.params, ...meta });
    return true;
  }

  /** This browser's weekly-review settings: when it's due, when it was done, this week's focus. */
  get review(): ReviewPrefs {
    return reviewStore.get();
  }

  /** A weekly review is waiting: the HUD offers it. */
  get reviewDue(): boolean {
    const r = this.review;
    return isReviewDue(r.day, r.lastAt);
  }

  setReview(patch: Partial<ReviewPrefs>) {
    reviewStore.set(patch);
    this.emit();
  }

  /** "Done: Order tiles · UNDO": takes the edit back, or reverses it once synced. */
  private offerUndo(op: Op, before: Workspace) {
    const inverse = inverseOp(op, before);
    if (!inverse) return;
    undoToast(undoLabel(op, before), () => {
      sfx('undo');
      const retracted = this.store.retract(op.opId);
      if (!retracted) this.dispatch(inverse, { undo: true });
      track('undo', { kind: op.kind, mode: retracted ? 'retract' : 'inverse' });
    });
  }

  private onRoute() {
    const r = this.route;
    if (r.view === 'prs') void this.loadPulls();
    // Looking at stats: catch up with commits made elsewhere, at most once a minute.
    if (r.pad === 'stats') void this.progress.refresh(60_000);
    if (r.view === 'pr' || r.view === 'pr-level') void this.loadPull(r.pr);
    // Not PR review: that's someone else's change, not where you were playing.
    if ((r.view === 'overworld' || r.view === 'world' || r.view === 'level') && uiPrefs().lastProject !== r.projectId)
      patchUiPrefs({ lastProject: r.projectId });
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

  /**
   * The last cloud ride: the dependency it left from and the level it went
   * to. While that level is on screen, a cloud waits there to ride back.
   */
  private cloudTrip?: { projectId: string; worldId: string; levelId: string; itemId: string; to: { worldId: string; levelId: string } };

  /** Sets off on a dependency's cloud to `to`, remembering the way back. Navigate after. */
  rideCloud(from: { projectId: string; worldId: string; levelId: string; itemId: string }, to: { worldId: string; levelId: string }) {
    track('cloud_ride', { back: false });
    this.arrival = { kind: 'cloud' };
    this.cloudTrip = { ...from, to: { worldId: to.worldId, levelId: to.levelId } };
  }

  /**
   * The ride back from the level on screen, if the hero came here by cloud
   * and the dependency it left from is still there.
   */
  cloudHome(): { route: Route; label: string } | undefined {
    const t = this.cloudTrip;
    const r = this.route;
    if (!t || r.view !== 'level' || r.subId || r.projectId !== t.projectId || r.worldId !== t.to.worldId || r.levelId !== t.to.levelId) return;
    const world = this.state?.worlds[t.worldId];
    const level = this.state && findLevel(this.state, t.worldId, t.levelId);
    if (!world || !level?.items.some((i) => i.id === t.itemId)) return;
    return {
      route: { view: 'level', projectId: t.projectId, worldId: t.worldId, levelId: t.levelId, itemId: t.itemId },
      label: `${world.name}: ${level.name}`,
    };
  }

  /** Rides the cloud back to the dependency it left from. Navigate to the returned route after. */
  rideHome(): Route | undefined {
    const home = this.cloudHome();
    if (!home || home.route.view !== 'level') return;
    track('cloud_ride', { back: true });
    this.arrival = { kind: 'cloud', itemId: home.route.itemId };
    this.cloudTrip = undefined;
    return home.route;
  }

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
      if (world && level) return { projectId: r.projectId, world, level, readonly: !this.caps.canEdit, budgets: budgetPrefs(this.state) };
    }
    if (r.view === 'pr-level') {
      const v = this.pullViews.get(r.pr);
      if (!v?.data || !v.diff) return;
      const world = pullLookup(v.data).world(r.projectId, r.worldId);
      const before = findLevelAt(v.data.base, r);
      const after = findLevelAt(v.data.head, r);
      if (!world || (!before && !after)) return;
      const diff = v.diff.levels.find(
        (l) => l.projectId === r.projectId && l.worldId === r.worldId && l.levelId === r.levelId,
      );
      const budgets = budgetPrefs(pullLookup(v.data).project(r.projectId));
      return { projectId: r.projectId, world, level: reviewLevel(before, after), diff, readonly: true, budgets };
    }
  }
}
