import Phaser from 'phaser';
import {
  dependencyMode,
  findLevel,
  isMvpItem,
  isResolved,
  layoutLevel,
  parseLevelRef,
  scoreLevel,
  type Item,
  type Level,
  type LevelDiff,
  type LevelLayout,
  type LayoutEntity,
  type StairStep,
  type World,
} from '@quest/shared';
import { THEMES } from '../sprites/pixels';
import { TILE, type ThemeKey } from '../sprites/render';
import { toast } from '../ui/toast';
import { itemForm, STATUS_LABEL, TYPE_INFO } from '../ui/forms';
import { bucket, track } from '../analytics';
import { itemAddr, type App } from '../app';
import { go } from '../router';
import { GROUND_Y, heroWalk, QuestScene, tex, WORLD_H } from './common';
import { PlayControls, type Controls } from './play/input';
import { ahead, buildWorld, criterionOf, EXIT_ID, FLAG_ID, HITBOX, nearest, newBody, step, stepId, TUNING, type Body, type PlayEvent, type PlayWorld } from './play/physics';
import { poleQuip } from './quips';

export interface LevelParams {
  projectId: string;
  worldId: string;
  levelId: string;
  /** Dependency whose sub-level is shown. */
  subId?: string;
  pr?: number;
}

/** Levels whose time-box warning was reported today (once per level per day). */
const warned = new Set<string>();

/** Play mode stops after this long without any input. */
const IDLE_MS = 2 * 60_000;

/** Bubble id for a sub-level's exit pipe (not an item; ids can't contain '!'). */
const EXIT = EXIT_ID;

interface View {
  entity: LayoutEntity;
  item: Item;
  root: Phaser.GameObjects.Container;
  flag?: Phaser.GameObjects.Image;
  top?: Phaser.GameObjects.Image;
}

interface BubbleSpec {
  title: string;
  lines: { text: string; size: number; muted?: boolean }[];
  buttons: { text: string; color: number; run: () => void }[];
  /** Where the tail points: centre x, and the top/bottom of the thing. */
  anchor: { cx: number; top: number; bottom: number };
}

/** A drawn stair step: its blocks, so ticking can light them. */
interface StepView {
  step: StairStep;
  blocks: Phaser.GameObjects.Image[];
}

/** Flagpole sections, bottom to top, each nested in the one below so the pole can bend. */
interface PoleView {
  segs: Phaser.GameObjects.Container[];
  flag: Phaser.GameObjects.Image;
  /** Pole centre and the top of its base block, in pixels. */
  x: number;
  base: number;
}

const POLE_H = 9;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const WALK_TILES_PER_SEC = 7;
const STATUS_COLOR: Record<Item['status'], string> = {
  todo: '#ffffff',
  doing: '#fee761',
  done: '#63c74d',
  dropped: '#8b9bb4',
};

export class LevelScene extends QuestScene {
  private params!: LevelParams;
  private stage?: Phaser.GameObjects.Container;
  private fx!: Phaser.GameObjects.Container;
  private views = new Map<string, View>();
  private hero!: Phaser.GameObjects.Sprite;
  private heroTargetX = 0;
  private layout!: LevelLayout;
  private prev = new Map<string, Item['status']>();
  private wasCleared = false;
  private following = true;
  private busy?: Promise<void>;
  private tooltip?: Phaser.GameObjects.Container;
  /**
   * Speech bubble with an item's details and quick actions. `auto` bubbles
   * follow the hero; explicit ones come from a click or the URL.
   */
  private bubble?: {
    itemId: string;
    box: Phaser.GameObjects.Container;
    auto: boolean;
    /** Buttons, for picking one with a gamepad in play mode. */
    buttons: { rect: Phaser.GameObjects.Rectangle; run: () => void }[];
    focus: number;
  };
  /** Hero-stop item whose auto bubble the user closed; stays closed until the hero moves on. */
  private dismissedAuto?: string;
  /** Flag height (criteria ticked, all of them once cleared) per level at the last render, to animate it. */
  private flagState = new Map<string, { k: number; cleared: boolean }>();
  /** The pole's flag waiting for the finale to raise it (to this y). */
  private flagPending?: { img: Phaser.GameObjects.Image; y: number };
  private steps = new Map<string, StepView>();
  private pole?: PoleView;
  /** Criteria ticked at the last render, to see which changed. */
  private prevCrit = new Map<string, boolean>();
  /** Newly ticked steps the hero hasn't landed on yet: drawn unlit until he does. */
  private unlit = new Set<string>();
  /** Stair step the hero is standing on (index), when he's up the stairs. */
  private perch?: number;
  private poleSpeech?: Phaser.GameObjects.Container;
  private lastPoleQuip?: string;
  private skyGfx?: Phaser.GameObjects.Graphics;
  /** Parallax layers live outside `stage`: containers ignore child scrollFactor. */
  private parallax: Phaser.GameObjects.Image[] = [];
  /** A sub-level's exit pipe, in pixels. */
  private exitPipe?: { x: number; w: number; top: number };
  /** Set while the hero is warping or riding away, so nothing else moves him. */
  private leaving = false;
  /** What the stage was last built from (the level, not the selection). */
  private sig = '';
  /** Selection the highlight was last drawn for. */
  private selSig = '';
  private selGfx?: Phaser.GameObjects.Graphics;
  /** Play mode: the hero is steered by gamepad or keyboard (see app.playing). */
  private playing = false;
  private controls?: PlayControls;
  private body?: Body;
  private world?: PlayWorld;
  /** Items completed by playing since the last rebuild, so they don't fire twice. */
  private played = new Set<string>();
  /** Touching the flagpole (fires once per touch). */
  private atFlag = false;
  /** Last time the player pressed or pushed anything. */
  private lastInput = 0;
  /** Look mode: the bubble follows whatever's ahead of the hero. */
  private looking = false;
  /** What look mode last showed (so a closed bubble isn't reopened every frame). */
  private lookId?: string;
  /** The pad is choosing the open bubble's buttons; the hero stands still. */
  private picking = false;

  constructor() {
    super('level');
  }

  init(params: LevelParams) {
    super.init();
    this.app.bubbleOpen = false;
    this.params = params;
    this.views.clear();
    this.prev.clear();
    this.steps.clear();
    this.prevCrit.clear();
    this.unlit.clear();
    this.perch = undefined;
    this.pole = undefined;
    this.flagPending = undefined;
    this.poleSpeech = undefined;
    this.stage = undefined;
    this.sig = '';
    this.selSig = '';
    this.selGfx = undefined;
    this.bubble = undefined;
    this.dismissedAuto = undefined;
    this.exitPipe = undefined;
    this.leaving = false;
    // A restart kills tweens mid-flight: their promises would never settle.
    this.busy = undefined;
    this.playing = false;
    this.body = undefined;
    this.world = undefined;
    this.controls = undefined;
    this.looking = false;
    this.lookId = undefined;
    this.picking = false;
  }

  private current() {
    return this.app.currentLevel();
  }

  create() {
    const cur = this.current();
    if (!cur) {
      // PR data or state still loading: restart once it arrives.
      this.watch(() => this.current() && this.scene.restart(this.params));
      return;
    }
    this.fx = this.add.container(0, 0).setDepth(50);
    this.hero = this.add.sprite(0, GROUND_Y, this.heroTex()).setOrigin(0, 1).setDepth(40);
    this.build(cur.world, cur.level, cur.diff);
    this.heroTargetX = this.layout.hero.x * TILE;
    this.hero.x = this.heroTargetX;
    const score = scoreLevel(cur.level);
    this.wasCleared = score.cleared;
    if (!cur.sub && !this.params.pr && (score.timer.phase === 'hurry' || score.timer.phase === 'overdue')) {
      const key = `${cur.projectId}/${cur.world.id}/${cur.level.id}:${new Date().toDateString()}`;
      if (!warned.has(key)) track('timebox_warning', { phase: score.timer.phase });
      warned.add(key);
    }
    // In a cleared level the hero has gone into the castle; a sub-level has none.
    if (this.wasCleared && !cur.sub) this.hero.setVisible(false);
    const arrival = this.app.takeArrival();
    // Start black so the arrival animation fades in without a flash of the old pose.
    if (arrival) this.cameras.main.fadeIn(350, 0, 0, 0);
    this.cameras.main.centerOn(this.hero.x + TILE, WORLD_H / 2);
    this.cameras.main.startFollow(this.hero, true, 0.08, 0.08, -this.viewWidth / 6, 0);
    this.enableScrolling(() => {
      this.following = false;
      this.cameras.main.stopFollow();
    });
    this.idle();
    this.controls = new PlayControls(this);
    this.watch(() => this.refresh());
    this.registerLocators();
    const onPad = () => !this.app.playing && toast('Controller connected: press START to play this level.', 'info', 4000);
    window.addEventListener('gamepadconnected', onPad);
    this.events.once('shutdown', () => window.removeEventListener('gamepadconnected', onPad));

    // Clicking empty space, or Esc, closes the bubble; Enter completes the item.
    this.input.on('pointerup', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (!this.dragged && over.length === 0) this.closeBubble();
    });
    const typing = () => !!document.activeElement?.matches('input, textarea, select, [contenteditable]');
    // While playing, the play controls handle Esc (back out of picking first).
    this.input.keyboard?.on('keydown-ESC', () => !typing() && !this.playing && this.closeBubble());
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (typing() || !this.bubble || !this.canEdit()) return;
      const cid = criterionOf(this.bubble.itemId);
      if (cid) this.setCriterion(cid, true);
      else this.setStatus(this.bubble.itemId, 'done');
    });

    // A deep-linked item gets its bubble; otherwise show the one the hero waits at.
    // Wait one frame so the camera has settled on the hero.
    this.time.delayedCall(0, async () => {
      if (arrival) {
        this.busy = this.arrive(arrival);
        await this.busy;
      }
      if (this.app.playing) void this.enterPlay();
      else if (!this.syncBubbleToSelection()) this.autoBubble();
    });
  }

  /**
   * The tour's show-and-tell: the hero bumps a ? block, dives into a warp pipe
   * and pops back out, or hops up the criteria stairs. Pure animation: no
   * statuses change, and he walks back to where he was waiting.
   */
  private registerDemos() {
    const pick = (kinds: string[]) => {
      const views = [...this.views.values()].filter((v) => kinds.includes(v.entity.kind));
      return views.find((v) => v.item.status !== 'done' && v.item.status !== 'dropped') ?? views[0];
    };
    const run = (show: () => Promise<void>) => async () => {
      if (this.leaving || this.playing || reducedMotion()) return;
      await this.busy;
      this.closeBubble();
      this.busy = (async () => {
        await show();
        // Back to his post (or into the castle, once cleared).
        if (this.wasCleared) await this.fadeHero();
        else if (this.layout.hero.kind === 'flag' && this.topReachable() !== undefined) await this.climbTo(this.topReachable());
        else await this.walkTo(this.layout.hero.x * TILE);
      })();
      await this.busy;
    };
    this.demo(
      'qblock',
      run(async () => {
        const v = pick(['qblock']);
        if (!v) return;
        const e = v.entity;
        await this.approach(e.x * TILE + (e.w * TILE - this.hero.width) / 2);
        // Up into the block's underside: it bounces and a coin pops out.
        await this.jump(Math.max(22, e.y * TILE - this.hero.height + 4));
        if (v.top) this.tweens.add({ targets: v.top, y: v.top.y - 4, yoyo: true, duration: 90 });
        this.popCoin(e.x * TILE + (e.w * TILE) / 2, GROUND_Y - (e.y + e.h) * TILE);
        await this.pause(500);
      }),
    );
    this.demo(
      'dependency',
      run(async () => {
        const v = pick(['warp', 'pipe', 'cloud']);
        if (!v) return;
        const e = v.entity;
        const top = GROUND_Y - (e.y + e.h) * TILE;
        const x = e.x * TILE + (e.w * TILE - this.hero.width) / 2;
        await this.approach(e.x * TILE - TILE);
        if (e.kind === 'cloud') {
          // Hop on, bob along with it, hop off.
          await this.hopTo(x, top + 2);
          await this.pause(700);
        } else {
          // Hop onto the mouth, slide down out of sight, then pop back up.
          await this.hopTo(x, top);
          this.hero.setDepth(-1);
          await new Promise<void>((resolve) => this.tweens.add({ targets: this.hero, y: top + 2 * TILE, duration: 450, onComplete: () => resolve() }));
          await this.pause(500);
          await new Promise<void>((resolve) => this.tweens.add({ targets: this.hero, y: top, duration: 450, onComplete: () => resolve() }));
          this.hero.setDepth(40);
        }
        await this.hopTo((e.x + e.w) * TILE + 4, GROUND_Y);
      }),
    );
    this.demo(
      'goal',
      run(async () => {
        if (this.current()?.sub || !this.layout.stairs.length) return;
        // Up the first few steps (as if ticked), then back down to the foot.
        await this.approach(this.footX());
        for (let i = 0; i < Math.min(3, this.layout.stairs.length); i++) {
          const spot = this.stepSpot(i);
          await this.hopTo(spot.x, spot.y, 260);
          this.perch = i;
          await this.pause(180);
        }
        await this.pause(400);
        await this.toGround();
      }),
    );
  }

  /** Spotlight targets for the tour: the first ? block, the first pipe or cloud, the stairs and pole. */
  private registerLocators() {
    const entity = (kinds: string[]) => () => {
      // An open one shows best (a done ? block is just a used brick).
      const views = [...this.views.values()].filter((v) => kinds.includes(v.entity.kind));
      const v = views.find((v) => v.item.status !== 'done' && v.item.status !== 'dropped') ?? views[0];
      if (!v) return;
      const e = v.entity;
      const raised = e.kind === 'pipe' || e.kind === 'warp' || e.kind === 'cloud' ? TILE : 0;
      const r = { x: e.x * TILE - 4, y: GROUND_Y - (e.y + e.h) * TILE - raised - 4, w: e.w * TILE + 8, h: e.h * TILE + raised + 8 };
      this.following = false;
      this.bringIntoView(r.x, r.w);
      return r;
    };
    this.locator('qblock', entity(['qblock']));
    this.registerDemos();
    this.locator('dependency', entity(['warp', 'cloud', 'pipe']));
    this.locator('goal', () => {
      if (this.current()?.sub) return;
      const L = this.layout;
      const x = ((L.stairs[0]?.x ?? L.flagX) - 0.5) * TILE;
      const r = { x, y: GROUND_Y - 11 * TILE, w: (L.flagX + 1.5) * TILE - x, h: 11 * TILE + 4 };
      this.following = false;
      this.bringIntoView(r.x, r.w);
      return r;
    });
  }

  protected onResize() {
    super.onResize();
    const cur = this.current();
    if (cur) this.build(cur.world, cur.level, cur.diff);
  }

  private refresh() {
    const cur = this.current();
    // On the way out (pipe or cloud), leave the stage alone: a rebuild would
    // strand the hero's ride mid-tween. The next scene draws fresh state.
    if (!cur || this.leaving) return;
    if (this.app.playing !== this.playing) void (this.app.playing ? this.enterPlay() : this.exitPlay());
    const sig = JSON.stringify([cur.level, cur.diff?.change]);
    if (sig === this.sig) {
      // Only the selection moved: shift the highlight, don't rebuild the stage
      // (that restarts every bobbing and pacing tween, a visible jump).
      if (JSON.stringify(this.app.selection ?? null) === this.selSig) return;
      this.drawSelection();
      this.syncBubbleToSelection();
      return;
    }
    const changed = this.diffStatuses(cur.level);
    const crit = this.diffCriteria(cur.level);
    // The hero lights a newly ticked step by landing on it.
    if (!this.playing && !cur.sub && !reducedMotion()) for (const c of crit) if (c.done) this.unlit.add(c.id);
    this.build(cur.world, cur.level, cur.diff);
    // Keep an open bubble in step with its item (it moves when the layout does),
    // and with the selection, which the URL can change.
    if (!this.syncBubbleToSelection() && this.bubble) {
      const item = cur.level.items.find((i) => i.id === this.bubble!.itemId);
      const cid = criterionOf(this.bubble.itemId);
      if (this.bubble.itemId === EXIT) this.openBubble(EXIT, { pop: false, auto: this.bubble.auto });
      else if (cid && this.steps.has(cid)) this.openBubble(this.bubble.itemId, { pop: false, auto: this.bubble.auto });
      else if (cid) this.closeBubble();
      else if (!item || item.status === 'done') this.closeBubble();
      else this.openBubble(item.id, { pop: false, auto: this.bubble.auto });
    }
    void this.animate(cur.level, changed, crit);
  }

  /** Criteria ticked or unticked since the last render. */
  private diffCriteria(level: Level) {
    return level.successCriteria.filter((c) => {
      const before = this.prevCrit.get(c.id);
      return before !== undefined && before !== c.done;
    });
  }

  private diffStatuses(level: Level) {
    const changed: Item[] = [];
    for (const item of level.items) {
      const before = this.prev.get(item.id);
      if (before && before !== item.status) changed.push(item);
    }
    return changed;
  }

  private build(world: World, level: Level, diff?: LevelDiff) {
    this.sig = JSON.stringify([level, diff?.change]);
    const sub = !!this.current()?.sub;
    const theme: ThemeKey = this.params.pr ? 'warp' : sub ? 'under' : world.theme;
    const colors = THEMES[theme];
    this.layout = layoutLevel(level, { sub });
    const L = this.layout;
    this.setupCamera(L.width * TILE, 22 * TILE);
    this.skyGfx?.destroy();
    this.skyGfx = this.sky(colors.sky, colors.skyLow);

    this.stage?.destroy();
    this.views.clear();
    const stage = (this.stage = this.add.container(0, 0).setDepth(0));

    // Background decoration, back to front.
    for (const p of this.parallax) p.destroy();
    this.parallax = [];
    for (const d of L.decorations.filter((d) => d.kind === 'cloud' && !sub))
      this.parallax.push(this.add.image(d.x * TILE, (13 - d.y) * TILE, 'cloud').setScale(0.5 + d.size * 0.25).setScrollFactor(0.4, 1).setAlpha(0.95).setDepth(-90));
    for (const d of L.decorations.filter((d) => d.kind === 'hill'))
      this.parallax.push(this.add.image(d.x * TILE, GROUND_Y, tex('hill', theme)).setOrigin(0, 1).setScale(0.6 + d.size * 0.3).setScrollFactor(0.7, 1).setDepth(-80));
    for (const d of L.decorations.filter((d) => d.kind === 'bush'))
      stage.add(this.add.image(d.x * TILE, GROUND_Y, 'bush').setOrigin(0, 1).setScale(0.4 + d.size * 0.2));

    // Ground.
    const groundW = Math.max(L.width * TILE, this.viewWidth + TILE);
    stage.add(this.add.tileSprite(0, GROUND_Y, groundW, TILE, tex('ground-top', theme)).setOrigin(0, 0));
    stage.add(this.add.tileSprite(0, GROUND_Y + TILE, groundW, this.floor - GROUND_Y - TILE, tex('ground-fill', theme)).setOrigin(0, 0));

    const cleared = scoreLevel(level).cleared;
    const fx = L.flagX * TILE;
    this.steps.clear();
    this.pole = undefined;
    if (sub) this.drawUnderground(stage, level, fx, cleared);
    else this.drawGoal(stage, level, fx, cleared);

    // Items.
    const byId = new Map(level.items.map((i) => [i.id, i]));
    for (const e of L.entities) {
      const item = byId.get(e.itemId);
      if (item) this.drawEntity(stage, e, item, diff);
    }

    this.drawSelection();

    this.prev = new Map(level.items.map((i) => [i.id, i.status]));
    this.prevCrit = new Map(level.successCriteria.map((c) => [c.id, c.done]));
    if (this.body) this.rebuildWorld();
  }

  /** Staircase, flagpole and castle at the end of a normal level. */
  private drawGoal(stage: Phaser.GameObjects.Container, level: Level, fx: number, cleared: boolean) {
    const L = this.layout;
    this.drawStairs(stage, level);
    const base = GROUND_Y - TILE;
    stage.add(this.add.image(fx, base, 'used').setOrigin(0, 0));
    // Each section hangs off the one below, so the pole can bend like a sprung rod.
    const segs: Phaser.GameObjects.Container[] = [];
    let parent = this.add.container(fx + 8, base);
    stage.add(parent);
    for (let i = 1; i <= POLE_H; i++) {
      segs.push(parent);
      parent.add(this.add.image(-8, -TILE, i === POLE_H ? 'pole-top' : 'pole').setOrigin(0, 0));
      if (i === POLE_H) break;
      const next = this.add.container(0, -TILE);
      parent.add(next);
      parent = next;
    }
    const poleHit = this.add.zone(fx - 8, GROUND_Y - (POLE_H + 1) * TILE, 3 * TILE, (POLE_H + 1) * TILE).setOrigin(0, 0);
    this.clickable(poleHit, () => this.app.select({ kind: 'criteria' }));
    stage.add(poleHit);

    // The flag climbs one notch per ticked criterion, and to the top once cleared.
    const criteria = level.successCriteria;
    const n = Math.max(1, criteria.length);
    const done = criteria.filter((c) => c.done).length;
    const k = cleared ? n : done;
    const top = base - (POLE_H - 1) * TILE + 2;
    const flagAt = (j: number) => Math.round(base - 9 - ((base - 9 - top) * j) / n);
    const flag = this.add.image(fx - 10, flagAt(k), cleared ? 'flag' : 'flag-grey').setOrigin(0, 0).setFlipX(true);
    stage.add(flag);
    const prev = this.flagState.get(level.id);
    this.flagPending = undefined;
    if (prev && prev.k !== k) {
      flag.y = flagAt(prev.k);
      // Just cleared: the flag goes up as the hero slides down (see finale).
      if (cleared && !prev.cleared && !reducedMotion()) this.flagPending = { img: flag, y: flagAt(k) };
      else this.tweens.add({ targets: flag, y: flagAt(k), duration: 600, ease: k > prev.k ? 'Back.out' : 'Quad.out' });
    }
    this.flagState.set(level.id, { k, cleared });
    this.pole = { segs, flag, x: fx + 8, base };

    stage.add(this.text(fx + 8, GROUND_Y + 6, `GOAL\n${done}/${criteria.length}`, 4, cleared ? '#63c74d' : '#fee761').setOrigin(0.5, 0));
    stage.add(this.add.image(L.castleX * TILE, GROUND_Y, 'castle').setOrigin(0, 1));
    if (cleared) stage.add(this.add.image(L.castleX * TILE + 36, GROUND_Y - 88, 'flag').setOrigin(0, 0));
  }

  /**
   * One step per success criterion, climbing to the pole. Must-do steps are
   * greyed until ticked, then lit; bonus steps are pink and see-through until
   * ticked. Labels sit in the dirt, alternating rows so neighbours don't clash.
   */
  private drawStairs(stage: Phaser.GameObjects.Container, level: Level) {
    for (const st of this.layout.stairs) {
      const c = level.successCriteria[st.index];
      const lit = st.done && !this.unlit.has(st.criterionId);
      const blocks: Phaser.GameObjects.Image[] = [];
      for (let row = 0; row < st.h; row++)
        for (let col = 0; col < st.w; col++) {
          const b = this.add.image((st.x + col) * TILE, GROUND_Y - (row + 1) * TILE, this.stepTex(st, lit)).setOrigin(0, 0);
          if (!st.mvp && !lit) b.setAlpha(0.5);
          blocks.push(b);
          stage.add(b);
        }
      this.steps.set(st.criterionId, { step: st, blocks });

      // Label in the dirt, trimmed to the room it has.
      const cx = (st.x + st.w / 2) * TILE;
      const maxW = 2 * st.w * TILE - 6;
      const full = `${st.mvp ? '' : '+ '}${c.text}`;
      const label = this.text(cx, GROUND_Y + 6 + (st.index % 2) * 12, full, 4, st.done ? '#63c74d' : st.mvp ? '#ffffff' : '#c0cbdc').setOrigin(0.5, 0);
      let txt = full;
      while (label.displayWidth > maxW && txt.length > 4) {
        txt = txt.slice(0, -2);
        label.setText(`${txt.trimEnd()}...`);
      }
      stage.add(label);

      const topY = GROUND_Y - st.h * TILE;
      const hit = this.add.zone(st.x * TILE, topY - TILE, st.w * TILE, (st.h + 1) * TILE).setOrigin(0, 0);
      const id = stepId(st.criterionId);
      this.clickable(hit, () => {
        if (this.bubble?.itemId === id) return this.closeBubble();
        this.openBubble(id);
        this.app.select({ kind: 'criteria' });
      });
      hit.on('pointerover', () => this.bubble?.itemId !== id && this.showCriterionTip(c.text, c.mvp, cx, topY - 2));
      hit.on('pointerout', () => this.tooltip?.destroy());
      stage.add(hit);
    }
  }

  private stepTex(st: StairStep, lit: boolean) {
    return !st.mvp ? 'stair-bonus' : lit ? 'stair' : 'stair-off';
  }

  /** Lights every step still waiting for the hero (he didn't get there). */
  private lightAll() {
    for (const id of [...this.unlit]) this.lightStep(id);
  }

  /** Lights (or greys) a step's blocks in place, without a rebuild. */
  private lightStep(criterionId: string, on = true) {
    const v = this.steps.get(criterionId);
    this.unlit.delete(criterionId);
    if (!v) return;
    for (const b of v.blocks) b.setTexture(this.stepTex(v.step, on)).setAlpha(!v.step.mvp && !on ? 0.5 : 1);
    if (on) this.poof((v.step.x + v.step.w / 2) * TILE, GROUND_Y - v.step.h * TILE - 4);
  }

  /**
   * A dependency's sub-level: brick ceiling, the pipe the hero dropped in
   * through, and an exit pipe back up where the flagpole would be.
   */
  private drawUnderground(stage: Phaser.GameObjects.Container, level: Level, fx: number, cleared: boolean) {
    const L = this.layout;
    // Two rows of brick ceiling along the top of the view.
    const ceiling = Math.min(0, this.cameras.main.getBounds().y) + 2 * TILE;
    stage.add(this.add.tileSprite(0, ceiling - 2 * TILE, L.width * TILE, 2 * TILE, 'brick').setOrigin(0, 0));
    // Entry pipe hanging from the ceiling.
    for (let y = ceiling; y < 3 * TILE; y += TILE) stage.add(this.add.image(TILE, y, 'pipe-body').setOrigin(0, 0));
    stage.add(this.add.image(TILE, 3 * TILE, 'pipe-top').setOrigin(0, 0).setFlipY(true));

    // Exit pipe: up arrow bobbing over it once the way is clear.
    const h = 2;
    const pipeTop = GROUND_Y - h * TILE;
    stage.add(this.add.image(fx, pipeTop, 'pipe-top').setOrigin(0, 0));
    for (let i = 1; i < h; i++) stage.add(this.add.image(fx, pipeTop + i * TILE, 'pipe-body').setOrigin(0, 0));
    this.exitPipe = { x: fx, w: 2 * TILE, top: pipeTop };
    if (cleared) {
      const arrow = this.add.image(fx + 8, pipeTop - TILE - 4, 'arrow-up').setOrigin(0, 0);
      stage.add(arrow);
      this.tweens.add({ targets: arrow, y: arrow.y - 4, yoyo: true, repeat: -1, duration: 450, ease: 'Sine.inOut' });
    }
    const left = level.items.filter((i) => isMvpItem(i) && !isResolved(i)).length;
    stage.add(
      this.text(fx + TILE, GROUND_Y + 6, cleared ? 'EXIT\nALL CLEAR' : left ? `EXIT\n${left} TO GO` : 'EXIT', 4, cleared ? '#63c74d' : '#fee761').setOrigin(0.5, 0),
    );
    const hit = this.add.zone(fx, pipeTop - TILE, 2 * TILE, (h + 1) * TILE).setOrigin(0, 0);
    this.clickable(hit, () => (this.bubble?.itemId === EXIT ? this.closeBubble() : this.openBubble(EXIT)));
    stage.add(hit);
  }

  private showCriterionTip(text: string, mvp: boolean, x: number, y: number) {
    this.tooltip?.destroy();
    const t = this.text(0, 0, `${text}${mvp ? '\nMVP: needed to clear' : '\nBonus'}`, 4, '#ffffff', 120).setOrigin(0.5, 1);
    const b = t.getBounds();
    const bg = this.add.rectangle(0, 2, b.width + 8, b.height + 6, 0x1a1c2c, 0.92).setOrigin(0.5, 1).setStrokeStyle(1, 0xfee761);
    this.tooltip = this.add.container(x, y - 4, [bg, t]).setDepth(100);
  }

  /** Pulsing outline round the selected item, or the flagpole for the criteria. */
  private drawSelection() {
    this.selGfx?.destroy();
    this.selGfx = undefined;
    const sel = this.app.selection;
    this.selSig = JSON.stringify(sel ?? null);
    const L = this.layout;
    const e: Pick<LayoutEntity, 'x' | 'y' | 'w' | 'h'> | undefined =
      sel?.kind === 'item'
        ? this.views.get(sel.id)?.entity
        : sel?.kind === 'criteria' && !this.current()?.sub
          ? // The staircase and the pole.
            { x: (L.stairs[0]?.x ?? L.flagX) - 0.25, y: 0, w: L.flagX + 1.25 - (L.stairs[0]?.x ?? L.flagX) + 0.25, h: 10 }
          : undefined;
    if (!e || !this.stage) return;
    const g = (this.selGfx = this.add.graphics());
    g.lineStyle(1, 0xfee761, 1);
    g.strokeRect(e.x * TILE - 2, GROUND_Y - (e.y + e.h) * TILE - 2, e.w * TILE + 4, e.h * TILE + 4);
    this.stage.add(g);
    this.tweens.add({ targets: g, alpha: 0.2, yoyo: true, repeat: -1, duration: 400 });
  }

  private drawEntity(stage: Phaser.GameObjects.Container, e: LayoutEntity, item: Item, diff?: LevelDiff) {
    const x = e.x * TILE;
    const top = GROUND_Y - (e.y + e.h) * TILE;
    const root = this.add.container(x, top);
    const view: View = { entity: e, item, root };
    const dropped = item.status === 'dropped';
    const done = item.status === 'done';
    const img = (key: string, dx = 0, dy = 0) => {
      const i = this.add.image(dx, dy, key).setOrigin(0, 0);
      root.add(i);
      return i;
    };

    switch (e.kind) {
      case 'qblock':
        view.top = img(done ? 'used' : 'qblock');
        if (item.status === 'doing') this.tweens.add({ targets: view.top, y: -2, yoyo: true, repeat: -1, duration: 350 });
        break;
      case 'checkpoint':
        img('pole-top');
        for (let i = 1; i < e.h; i++) img('pole', 0, i * TILE);
        view.flag = img(done ? 'flag' : 'flag-grey', 8, done ? 4 : item.status === 'doing' ? TILE * 1.5 : (e.h - 1) * TILE - 4);
        break;
      case 'wall':
        if (done) img('rubble', 0, (e.h - 1) * TILE);
        else for (let i = 0; i < e.h; i++) img('brick', 0, i * TILE);
        break;
      case 'pipe': {
        const unmet = !done && !dropped;
        if (unmet) {
          view.top = img('plant', 8, -TILE + 4);
          this.tweens.add({ targets: view.top, y: -TILE + 10, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
        }
        img('pipe-top');
        for (let i = 1; i < e.h; i++) img('pipe-body', 0, i * TILE);
        break;
      }
      case 'warp': {
        // A way down into the dependency's steps: arrow while it's still needed.
        img('pipe-top');
        for (let i = 1; i < e.h; i++) img('pipe-body', 0, i * TILE);
        const steps = item.subtasks ?? [];
        const left = steps.filter((st) => isMvpItem(st as Item) && !isResolved(st as Item)).length;
        if (!done && !dropped) {
          view.top = img('arrow-down', 8, -TILE - 2);
          this.tweens.add({ targets: view.top, y: -TILE + 2, yoyo: true, repeat: -1, duration: 450, ease: 'Sine.inOut' });
        }
        const count = `${steps.length - left}/${steps.length}`;
        root.add(this.text(e.w * TILE / 2 - 1, TILE + 6, count, 4, left ? '#ffffff' : '#63c74d').setOrigin(0.5, 0));
        break;
      }
      case 'cloud': {
        // A lift to the level this depends on.
        const c = img('cloud-ride', 0, -4).setScale(1.5);
        if (!done && !dropped) this.tweens.add({ targets: c, y: -8, yoyo: true, repeat: -1, duration: 1100, ease: 'Sine.inOut' });
        else c.setAlpha(0.6);
        view.top = c;
        break;
      }
      case 'critter':
        if (done) img('critter-flat');
        else {
          view.top = img('critter');
          this.tweens.add({ targets: view.top, x: item.status === 'doing' ? 6 : 12, yoyo: true, repeat: -1, duration: item.status === 'doing' ? 1400 : 900 });
        }
        break;
      case 'sign':
        view.top = img(done ? 'sign-ok' : 'sign-q');
        img('post', 0, TILE);
        break;
      case 'coins':
        for (let i = 0; i < 3; i++) {
          const c = img(done ? 'coin-ghost' : 'coin', i * TILE, 0);
          if (!done) this.tweens.add({ targets: c, y: -3, yoyo: true, repeat: -1, duration: 500, delay: i * 120 });
        }
        break;
    }
    if (dropped) root.setAlpha(0.3);
    if (item.status === 'doing') {
      const sp = this.add.image(e.w * TILE - 4, -6, 'sparkle').setOrigin(0, 0);
      root.add(sp);
      this.tweens.add({ targets: sp, alpha: 0.2, yoyo: true, repeat: -1, duration: 300 });
    }

    // Review badge.
    const change = diff?.items[item.id]?.change;
    if (change) {
      const color = { added: 0x63c74d, modified: 0xfeae34, removed: 0xe43b44 }[change];
      const g = this.add.graphics();
      g.lineStyle(1, color, 1).strokeRect(-2, -2, e.w * TILE + 4, e.h * TILE + 4);
      g.fillStyle(color, 1).fillCircle(e.w * TILE + 1, -3, 5);
      root.add(g);
      root.add(this.text(e.w * TILE + 1, -3, { added: '+', modified: '!', removed: 'x' }[change], 5, '#1a1c2c').setOrigin(0.5).setStroke('#ffffff', 0));
      this.tweens.add({ targets: g, alpha: 0.4, yoyo: true, repeat: -1, duration: 600 });
    }

    // Label in the dirt (or above floating coins).
    const label = item.title.length > 22 ? `${item.title.slice(0, 21)}…` : item.title;
    const lx = x + (e.w * TILE) / 2;
    const t =
      e.kind === 'coins'
        ? this.text(lx, top - 4, label, 4, STATUS_COLOR[item.status], 60).setOrigin(0.5, 1)
        : this.text(lx, GROUND_Y + 18, label, 4, STATUS_COLOR[item.status], 58).setOrigin(0.5, 0);
    stage.add(t);

    root.setSize(e.w * TILE, e.h * TILE);
    // Pipes are clickable above the mouth too, where the plant or arrow is.
    const above = (e.kind === 'pipe' || e.kind === 'warp') && view.top ? TILE : 0;
    const hit = this.add.zone(0, -above, e.w * TILE, e.h * TILE + above + (e.kind === 'cloud' ? 6 : 0)).setOrigin(0, 0);
    root.add(hit);
    this.clickable(hit, () => {
      if (this.bubble?.itemId === item.id) return this.closeBubble();
      this.openBubble(item.id);
      this.app.select({ kind: 'item', id: item.id });
    });
    hit.on('pointerover', () => this.bubble?.itemId !== item.id && this.showTooltip(view));
    hit.on('pointerout', () => this.tooltip?.destroy());
    stage.add(root);
    this.views.set(item.id, view);
  }

  private showTooltip(v: View) {
    this.tooltip?.destroy();
    const { entity: e, item } = v;
    const text = `${item.title}\n${item.type.toUpperCase()} · ${item.status.toUpperCase()}${item.type !== 'stretch' && item.mvp === false ? ' · OPTIONAL' : ''}`;
    const t = this.text(0, 0, text, 4, '#ffffff', 110).setOrigin(0.5, 1);
    const b = t.getBounds();
    const bg = this.add.rectangle(0, 2, b.width + 8, b.height + 6, 0x1a1c2c, 0.9).setOrigin(0.5, 1).setStrokeStyle(1, 0xfee761);
    const x = Phaser.Math.Clamp(e.x * TILE + (e.w * TILE) / 2, this.cameras.main.scrollX + b.width / 2 + 6, this.cameras.main.scrollX + this.viewWidth - b.width / 2 - 6);
    this.tooltip = this.add.container(x, GROUND_Y - (e.y + e.h) * TILE - 18, [bg, t]).setDepth(100);
  }

  // ---- Speech bubble ----

  private canEdit() {
    const cur = this.current();
    return !!cur && !cur.readonly && this.app.caps.canEdit;
  }

  private setStatus(itemId: string, status: Item['status']) {
    const cur = this.current();
    if (!cur) return;
    if (status === 'done' || status === 'dropped') this.closeBubble();
    this.app.dispatch({ kind: 'setItemStatus', ...itemAddr(cur), itemId, status });
  }

  private setCriterion(criterionId: string, done: boolean) {
    const cur = this.current();
    if (!cur) return;
    // Ticking sends the hero up the stairs: get the bubble out of his way.
    if (done) this.closeBubble();
    this.app.dispatch({ kind: 'setCriterion', projectId: cur.projectId, worldId: cur.world.id, levelId: cur.level.id, criterionId, done });
  }

  /** Closing an auto bubble remembers it; closing a chosen one clears the selection (and URL). */
  private closeBubble() {
    const b = this.bubble;
    if (!b) return;
    b.box.destroy();
    this.bubble = undefined;
    this.app.bubbleOpen = false;
    this.picking = false;
    if (b.auto) this.dismissedAuto = b.itemId;
    else if (this.app.selection?.kind === 'item' && this.app.selection.id === b.itemId) this.app.select(undefined);
    else if (this.app.selection?.kind === 'criteria' && criterionOf(b.itemId)) this.app.select(undefined);
  }

  /** Opens the bubble for the selected item, if any. Returns true when a selection drives it. */
  private syncBubbleToSelection(): boolean {
    const sel = this.app.selection;
    // A stair step's bubble goes with the criteria being selected.
    const cid = this.bubble && criterionOf(this.bubble.itemId);
    if (sel?.kind === 'criteria' && cid) {
      if (this.steps.has(cid)) this.openBubble(stepId(cid), { pop: false });
      else this.closeBubble();
      return true;
    }
    if (sel?.kind !== 'item') {
      if (this.bubble && !this.bubble.auto) {
        this.bubble.box.destroy();
        this.bubble = undefined;
        this.app.bubbleOpen = false;
        this.picking = false;
      }
      return false;
    }
    if (!this.views.has(sel.id)) return false;
    if (this.bubble?.itemId !== sel.id || this.bubble.auto) this.openBubble(sel.id, { pop: this.bubble?.itemId !== sel.id });
    else this.openBubble(sel.id, { pop: false });
    return true;
  }

  /** Shows the bubble for the item the hero is waiting at, unless the user closed it. */
  private autoBubble() {
    if (this.leaving || this.playing) return;
    // In a sub-level, the hero waiting at the exit pipe means "you're done here".
    const atExit = !!this.current()?.sub && this.layout.hero.kind === 'flag' && scoreLevel(this.current()!.level).cleared;
    const id = atExit ? EXIT : this.layout.hero.itemId;
    if (this.dismissedAuto && this.dismissedAuto !== id) this.dismissedAuto = undefined;
    if (!id || id === this.dismissedAuto) return;
    if (this.bubble && (!this.bubble.auto || this.bubble.itemId === id)) return;
    this.openBubble(id, { auto: true });
  }

  /** What a bubble says and offers: an item's, or the sub-level exit's. */
  private bubbleSpec(id: string): BubbleSpec | undefined {
    const cur = this.current();
    if (!cur) return;
    const edit = this.canEdit();
    const spec: BubbleSpec = { title: '', lines: [], buttons: [], anchor: { cx: 0, top: 0, bottom: 0 } };
    const button = (text: string, color: number, run: () => void) => spec.buttons.push({ text, color, run });

    if (id === EXIT) {
      const pipe = this.exitPipe;
      const dep = cur.sub?.dep;
      if (!pipe || !dep) return;
      const cleared = scoreLevel(cur.level).cleared;
      spec.title = cleared ? 'All clear!' : 'Exit pipe';
      if (!this.playing)
        spec.lines.push({
          text: cleared
            ? `Every must-do step for "${dep.title}" is out of the way.`
            : 'Back up to the level. Your steps stay here for next time.',
          size: 4,
        });
      if (edit && !isResolved(dep) && cleared) button('GOT IT! WARP UP', 0x63c74d, () => void this.leaveSub(true));
      button('WARP UP', 0xdfe9f0, () => void this.leaveSub(false));
      spec.anchor = { cx: pipe.x + pipe.w / 2, top: pipe.top, bottom: GROUND_Y };
      return spec;
    }

    const cid = criterionOf(id);
    if (cid) {
      const sv = this.steps.get(cid);
      const c = cur.level.successCriteria.find((x) => x.id === cid);
      if (!sv || !c) return;
      spec.title = c.text;
      spec.lines.push({ text: `${c.mvp ? 'MUST-DO STEP' : 'BONUS STEP'} · ${c.done ? 'TICKED' : 'NOT YET'}`, size: 3.5, muted: true });
      if (!this.playing)
        spec.lines.push({ text: c.mvp ? 'Needed to clear the level.' : 'Optional: skip it if it is not worth it.', size: 3.5, muted: true });
      if (edit) {
        if (c.done) button('UNTICK', 0xc0cbdc, () => this.setCriterion(cid, false));
        else button('TICK!', 0x63c74d, () => this.setCriterion(cid, true));
      }
      const st = sv.step;
      spec.anchor = { cx: (st.x + st.w / 2) * TILE, top: GROUND_Y - st.h * TILE, bottom: GROUND_Y };
      return spec;
    }

    const v = this.views.get(id);
    if (!v) return;
    const { item, entity: e } = v;
    const info = TYPE_INFO[item.type];
    const optional = item.type === 'stretch' || item.mvp === false;
    spec.title = item.title;
    spec.lines.push({ text: `${info.label.toUpperCase()} · ${STATUS_LABEL[item.status].toUpperCase()}${optional ? ' · OPTIONAL' : ''}`, size: 3.5, muted: true });
    // Playing: just the name and status, so the bubble hides less of the level.
    if (item.notes && !this.playing) spec.lines.push({ text: item.notes.length > 160 ? `${item.notes.slice(0, 157)}...` : item.notes, size: 4 });
    if (item.dependsOn?.length && !this.playing) {
      const names = item.dependsOn.map((d) => cur.level.items.find((i) => i.id === d)?.title ?? d);
      spec.lines.push({ text: `After: ${names.join(', ')}`, size: 3.5, muted: true });
    }

    const mode = cur.sub ? undefined : dependencyMode(item);
    const resolved = isResolved(item);
    if (mode === 'warp') {
      const steps = (item.subtasks ?? []) as Item[];
      const left = steps.filter((st) => isMvpItem(st) && !isResolved(st)).length;
      if (!this.playing) spec.lines.push({ text: left ? `Warp pipe: ${left} of ${steps.length} steps to go below.` : `Warp pipe: all ${steps.length} steps done below.`, size: 3.5, muted: true });
      button('WARP IN', 0x63c74d, () => void this.enterPipe(item.id));
    }
    if (mode === 'cloud') {
      const target = this.refTarget(item);
      if (!this.playing) spec.lines.push({ text: target ? `Cloud to ${target.label}${target.cleared ? ' (cleared)' : ''}` : `Cloud to ${item.levelRef}`, size: 3.5, muted: true });
      if (target) button('HOP ON', 0x8fd3ff, () => void this.rideCloud(item.id));
    }

    if (edit) {
      if (resolved) button(item.status === 'done' ? 'REOPEN' : 'RESTORE', 0xc0cbdc, () => this.setStatus(item.id, 'todo'));
      else if (mode === 'warp' || mode === 'cloud') {
        // Close it (you've got what you needed) or skip it (turns out you don't need it).
        button('GOT IT!', 0xfee761, () => {
          track('dependency_resolve', { action: 'close', dep_mode: mode });
          this.setStatus(item.id, 'done');
        });
        button('JUMP OVER', 0xfeae34, () => {
          track('dependency_resolve', { action: 'skip', dep_mode: mode });
          this.setStatus(item.id, 'dropped');
        });
      } else {
        button('DONE!', 0x63c74d, () => this.setStatus(item.id, 'done'));
        if (item.status === 'todo') button('START', 0xfeae34, () => this.setStatus(item.id, 'doing'));
      }
      // A plain dependency can grow steps of its own: open its (empty) sub-level.
      if (mode === 'plain') button('ADD STEPS', 0xdfe9f0, () => void this.enterPipe(item.id));
      button('EDIT', 0xdfe9f0, () => {
        this.closeBubble();
        itemForm(this.app, cur, item);
      });
    }
    const raised = (e.kind === 'pipe' || e.kind === 'warp') && !!v.top;
    spec.anchor = {
      cx: e.x * TILE + (e.w * TILE) / 2,
      top: GROUND_Y - (e.y + e.h) * TILE - (raised ? TILE : 0) - (e.kind === 'cloud' ? 6 : 0),
      bottom: GROUND_Y - e.y * TILE,
    };
    return spec;
  }

  /** The level a cloud goes to, if it still exists. */
  private refTarget(item: Item) {
    const state = this.app.state;
    const ref = item.levelRef ? parseLevelRef(item.levelRef) : undefined;
    const level = state && ref ? findLevel(state, ref.worldId, ref.levelId) : undefined;
    if (!ref || !level) return;
    const world = state!.worlds[ref.worldId];
    return { ...ref, label: `${world.name}: ${level.name}`, cleared: scoreLevel(level).cleared };
  }

  private openBubble(itemId: string, opts: { pop?: boolean; auto?: boolean } = {}) {
    const { pop = true, auto = false } = opts;
    this.bubble?.box.destroy();
    this.bubble = undefined;
    this.app.bubbleOpen = false;
    const spec = this.bubbleSpec(itemId);
    if (!spec) return;
    this.tooltip?.destroy();
    // Playing: a smaller bubble whose buttons only show once you pick (Up).
    const compact = this.playing;
    const actions = spec.buttons;
    if (compact) {
      if (!this.picking) spec.buttons = [];
      if (actions.length) spec.lines.push({ text: this.picking ? 'LEFT/RIGHT · A PRESS · B BACK' : 'UP: ACTIONS', size: 3, muted: true });
    }

    const PAD = compact ? 4 : 6;
    const GAP = compact ? 2 : 3;
    const MAX_W = compact ? 112 : 164;
    const CLOSE = compact ? 7 : 9;
    const INK = '#1a1c2c';
    const MUTED = '#5a6988';
    const inner = MAX_W - 2 * PAD;
    const box = this.add.container(0, 0).setDepth(150);
    const label = (str: string, size: number, color: string, wrap: number) =>
      this.text(0, 0, str, size, color, wrap).setOrigin(0, 0).setStroke('#ffffff', 0).setAlign('left');

    // 1. Text blocks, wrapped to the widest the bubble may be.
    const title = label(spec.title, compact ? 4 : 5, INK, inner - CLOSE - 4);
    const lines = spec.lines.map((l) => label(l.text, l.size, l.muted ? MUTED : INK, inner));

    // 2. Action buttons (all the same height).
    const buttons = spec.buttons.map((b) => {
      const t = label(b.text, 4, INK, 200).setOrigin(0.5);
      return { ...b, text: t, w: Math.ceil(t.displayWidth) + 8 };
    });

    // 3. Size the bubble to its content.
    const btnH = buttons.length ? Math.ceil(buttons[0].text.displayHeight) + 6 : 0;
    const rowW = buttons.reduce((w, b) => w + b.w, 0) + GAP * Math.max(0, buttons.length - 1);
    const contentW = Math.max(
      title.displayWidth + CLOSE + 6,
      ...lines.map((l) => l.displayWidth),
      Math.min(rowW, inner),
    );
    // +1 slack so rounding never pushes the last button onto a second row.
    const W = Math.ceil(Phaser.Math.Clamp(contentW + 2 * PAD + 1, compact ? 48 : 84, MAX_W));

    // 4. Lay out top to bottom.
    let y = PAD;
    title.setPosition(PAD, y);
    y += Math.max(title.displayHeight, CLOSE) + GAP;
    for (const l of lines) {
      l.setPosition(PAD, y);
      y += l.displayHeight + 2;
    }
    let rule = -1;
    const rects: Phaser.GameObjects.Rectangle[] = [];
    if (buttons.length) {
      y += 2;
      rule = Math.round(y);
      y += GAP + 1;
      let x = PAD;
      for (const b of buttons) {
        if (x > PAD && x + b.w > W - PAD + 0.5) {
          x = PAD;
          y += btnH + GAP;
        }
        const rect = this.add.rectangle(Math.round(x), Math.round(y), b.w, btnH, b.color).setOrigin(0).setStrokeStyle(1, 0x1a1c2c);
        const hover = Phaser.Display.Color.IntegerToColor(b.color).brighten(12).color;
        this.clickable(rect, b.run);
        rect.on('pointerover', () => rect.setFillStyle(hover));
        rect.on('pointerout', () => rect.setFillStyle(b.color));
        rects.push(rect);
        b.text.setPosition(Math.round(x + b.w / 2), Math.round(y + btnH / 2));
        x += b.w + GAP;
      }
      y += btnH;
    }
    const H = Math.round(y + PAD);

    // 5. Bubble, tail and a window-style close button.
    // Keep inside the level (not the momentary view: the camera may still be moving).
    const bounds = this.cameras.main.getBounds();
    const { cx, top, bottom } = spec.anchor;
    const TAIL = 7;
    const above = top - TAIL - H > Math.max(bounds.y, 0) + 2;
    const left = Math.round(Phaser.Math.Clamp(cx - W / 2, bounds.x + 3, bounds.right - W - 3));
    const boxTop = Math.round(above ? top - TAIL - H - 1 : bottom + TAIL + 1);
    box.setPosition(left, boxTop);

    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1).fillRoundedRect(0, 0, W, H, 4);
    g.lineStyle(1.5, 0x1a1c2c, 1).strokeRoundedRect(0, 0, W, H, 4);
    if (rule >= 0) g.lineStyle(1, 0xdfe9f0, 1).lineBetween(PAD, rule, W - PAD, rule);
    const tx = Math.round(Phaser.Math.Clamp(cx - left, 9, W - 9));
    const edgeY = above ? H : 0;
    const tipY = above ? H + TAIL : -TAIL;
    g.fillStyle(0xffffff, 1).fillTriangle(tx - 5, edgeY, tx + 5, edgeY, tx, tipY);
    g.lineStyle(1.5, 0x1a1c2c, 1).lineBetween(tx - 5, edgeY, tx, tipY).lineBetween(tx + 5, edgeY, tx, tipY);
    g.lineStyle(2, 0xffffff, 1).lineBetween(tx - 4, edgeY, tx + 4, edgeY);

    const close = this.add.container(W - PAD - CLOSE, PAD);
    const closeBg = this.add.rectangle(0, 0, CLOSE, CLOSE, 0xe43b44).setOrigin(0).setStrokeStyle(1, 0x1a1c2c);
    const cross = this.add.graphics().lineStyle(1.5, 0xffffff, 1);
    cross.lineBetween(2.5, 2.5, CLOSE - 2.5, CLOSE - 2.5).lineBetween(CLOSE - 2.5, 2.5, 2.5, CLOSE - 2.5);
    close.add([closeBg, cross]);
    this.clickable(closeBg, () => this.closeBubble());
    closeBg.on('pointerover', () => closeBg.setFillStyle(0xf6757a));
    closeBg.on('pointerout', () => closeBg.setFillStyle(0xe43b44));

    // Swallow clicks on the bubble body so they don't close it.
    const hit = this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();
    box.add([g, hit, title, ...lines, ...rects, ...buttons.map((b) => b.text), close]);

    if (pop) {
      box.setY(boxTop + (above ? 4 : -4));
      this.tweens.add({ targets: box, y: boxTop, duration: 140, ease: 'Back.out' });
      // A clicked or deep-linked item may be off to the side: bring its bubble into view.
      // Computed from scroll/zoom: worldView isn't valid until the first render.
      const cam = this.cameras.main;
      const viewW = cam.width / cam.zoom;
      const viewX = cam.scrollX + (cam.width - viewW) / 2;
      // While playing the camera stays on the hero.
      if (!auto && !this.playing && (left < viewX || left + W > viewX + viewW)) {
        this.following = false;
        cam.stopFollow();
        cam.pan(left + W / 2, cam.midPoint.y, 350, 'Sine.easeInOut');
      }
    }
    this.bubble = { itemId, box, auto, buttons: rects.map((rect, i) => ({ rect, run: buttons[i].run })), focus: 0 };
    this.app.bubbleOpen = true;
    if (this.picking) this.focusButton(0);
  }

  /** Outlines the bubble button a gamepad would press. */
  private focusButton(i: number) {
    const b = this.bubble;
    if (!b?.buttons.length) return;
    b.focus = (i + b.buttons.length) % b.buttons.length;
    b.buttons.forEach(({ rect }, k) => rect.setStrokeStyle(k === b.focus ? 2 : 1, k === b.focus ? 0x0099db : 0x1a1c2c));
  }

  // ---- Play mode ----

  /** Hands the hero to the player once any scripted animation has finished. */
  private async enterPlay() {
    this.playing = true;
    this.closeBubble();
    await this.busy;
    if (!this.playing || this.leaving || this.body) return;
    const L = this.layout;
    this.tweens.killTweensOf(this.hero);
    // A cleared level's hero is waiting in the castle: start again from the left.
    const x = this.hero.visible && this.hero.x < L.castleX * TILE ? this.hero.x : 2 * TILE;
    // Up the stairs he stays up the stairs; anywhere else he starts on the ground.
    const y = this.perch !== undefined && this.hero.visible ? this.hero.y : GROUND_Y;
    this.perch = undefined;
    this.hero.setVisible(true).setAlpha(1).setDepth(40).setPosition(x, y);
    this.idle();
    this.body = newBody(x + HITBOX.offX, GROUND_Y);
    this.body.y = y - this.body.h;
    this.rebuildWorld();
    this.controls?.capture(true, this);
    this.lastInput = Date.now();
    this.following = true;
    this.cameras.main.startFollow(this.hero, true, 0.1, 0.1, 0, 0);
    track('play_mode', { on: true });
    toast('PLAY! Arrows or stick to move, A or Space to jump (hold Shift/B to run), Y or E to show what is ahead, Up to pick, Down into pipes. START or Esc stops.', 'info', 5000);
  }

  /** Back to the hero walking himself to wherever he's needed. */
  private exitPlay() {
    this.playing = false;
    this.controls?.capture(false, this);
    this.looking = false;
    this.lookId = undefined;
    if (!this.body) return;
    this.body = undefined;
    this.world = undefined;
    this.closeBubble();
    track('play_mode', { on: false });
    if (this.leaving) return;
    this.hero.setAlpha(1).setFlipX(false);
    this.following = true;
    this.cameras.main.startFollow(this.hero, true, 0.08, 0.08, -this.viewWidth / 6, 0);
    const prev = this.busy;
    this.busy = (async () => {
      await prev;
      if (this.playing || this.leaving) return;
      await this.toGround();
      // A level cleared while playing: the hero's place is in the castle.
      if (this.wasCleared && !this.current()?.sub) return this.fadeHero();
      await this.walkTo(this.layout.hero.x * TILE);
      this.autoBubble();
    })();
  }

  private rebuildWorld() {
    this.world = buildWorld(this.layout, { tile: TILE, groundY: GROUND_Y, sub: !!this.current()?.sub });
    this.played.clear();
  }

  update(_time: number, delta: number) {
    const controls = this.controls;
    if (!controls) return;
    const c = controls.read();
    // A form is open: keys belong to it.
    if (!this.input.manager.enabled || document.activeElement?.matches('input, textarea, select, [contenteditable]')) {
      // Time spent in a form isn't idling.
      this.lastInput = Date.now();
      return;
    }
    if (!this.playing) {
      if (c.quitPressed && this.app.canPlay) this.app.setPlaying(true);
      return;
    }
    if (c.quitPressed && !this.picking) return this.app.setPlaying(false);
    // Esc backs out one step at a time: picking, then a bubble, then play mode.
    if (c.escPressed && !this.picking && (!this.bubble || this.looking)) return this.app.setPlaying(false);
    const now = Date.now();
    if (c.active || !this.lastInput) this.lastInput = now;
    else if (now - this.lastInput > IDLE_MS) return this.app.setPlaying(false, 'idle');
    const body = this.body;
    const world = this.world;
    if (!body || !world || this.leaving) return;

    let input: Controls = c;
    if (c.lookPressed) this.setLooking(!this.looking);
    if (this.picking && this.bubble) {
      // Picking: the pad chooses the bubble's buttons and the hero stands still.
      if (c.leftPressed) this.focusButton(this.bubble.focus - 1);
      if (c.rightPressed) this.focusButton(this.bubble.focus + 1);
      if (c.backPressed || c.quitPressed || c.escPressed) this.stopPicking();
      else if (c.confirmPressed) this.bubble.buttons[this.bubble.focus]?.run();
      input = { ...c, x: 0, jumpHeld: false, jumpPressed: false, downPressed: false };
    } else if (c.upPressed) {
      // Up picks from the bubble that's showing, or opens the one for what's here.
      if (!this.bubble) this.lookAt(nearest(body, world)?.id);
      if (this.bubble) this.startPicking();
    } else if ((c.backPressed || c.escPressed) && this.bubble && !this.looking) this.closeBubble();
    if (this.looking && !this.picking) this.lookAhead(ahead(body, world)?.id);
    if (!this.picking && !this.following) {
      this.following = true;
      this.cameras.main.startFollow(this.hero, true, 0.1, 0.1, 0, 0);
    }

    const events = step(body, input, world, delta / 1000, this.played);
    let flag = false;
    for (const e of events) {
      if (e.kind === 'flag') flag = true;
      else this.onPlayEvent(e);
      // Entering a pipe or cloud hands the hero to its own animation.
      if (this.leaving || !this.body) return;
    }
    if (flag && !this.atFlag) return this.touchFlag(body);
    this.atFlag = flag;
    this.drawHero(body);
  }

  /** Mirrors the physics body onto the sprite, with the right frame. */
  private drawHero(body: Body) {
    const h = this.hero;
    const walk = heroWalk(this.app.heroId);
    h.setPosition(Math.round(body.x - HITBOX.offX), Math.round(body.y + body.h));
    h.setFlipX(body.facing < 0);
    if (!body.onGround) {
      h.anims.stop();
      h.setTexture(this.heroTex('jump'));
    } else if (Math.abs(body.vx) > 8) {
      if (h.anims.currentAnim?.key !== walk || !h.anims.isPlaying) h.play(walk);
      h.anims.timeScale = Math.max(0.6, Math.abs(body.vx) / TUNING.walk);
    } else if (h.anims.isPlaying || h.texture.key !== this.heroTex()) this.idle();
    // Flicker while recovering from a hit.
    h.setAlpha(body.invuln > 0 && Math.floor(body.invuln * 12) % 2 ? 0.25 : 1);
  }

  /** Opens the bubble for `id`, as if it had been clicked. */
  private lookAt(id?: string) {
    if (!id) return;
    if (id === FLAG_ID) return this.app.select({ kind: 'criteria' });
    this.openBubble(id);
    if (criterionOf(id)) this.app.select({ kind: 'criteria' });
    else if (id !== EXIT) this.app.select({ kind: 'item', id });
  }

  /** Y / E: the bubble follows whatever's ahead, or goes away. */
  private setLooking(on: boolean) {
    this.looking = on;
    this.lookId = undefined;
    if (!on) {
      this.closeBubble();
      if (this.app.selection) this.app.select(undefined);
    }
    toast(on ? 'LOOK ON: the bubble shows what is ahead. Up to pick a button.' : 'LOOK OFF', 'info', 1800);
  }

  /** Look mode: show the bubble of the nearest thing ahead, when that changes. */
  private lookAhead(id?: string) {
    if (id === this.lookId) return;
    this.lookId = id;
    if (!id) {
      this.closeBubble();
      if (this.app.selection) this.app.select(undefined);
      return;
    }
    if (id === FLAG_ID) this.closeBubble();
    this.lookAt(id);
  }

  private startPicking() {
    this.picking = true;
    // Redraw with the picking hint, first button outlined.
    if (this.bubble) this.openBubble(this.bubble.itemId, { pop: false });
  }

  /** B: back to walking; look mode keeps its bubble, otherwise it closes. */
  private stopPicking() {
    if (!this.looking) return this.closeBubble();
    this.picking = false;
    if (this.bubble) this.openBubble(this.bubble.itemId, { pop: false });
  }

  private onPlayEvent(e: Exclude<PlayEvent, { kind: 'flag' }>) {
    if (e.kind === 'jump') return;
    if (e.kind === 'hurt') {
      this.cameras.main.shake(120, 0.003);
      return;
    }
    if (e.kind === 'flagWhack') return this.whack(e.left);
    const cur = this.current();
    if (!cur) return;
    if (e.kind === 'step') {
      // Landed on a step: its criterion is ticked.
      this.played.add(e.id);
      const cid = criterionOf(e.id)!;
      if (this.canEdit()) {
        track('play_complete', { how: 'step' });
        this.setCriterion(cid, true);
      } else this.lightStep(cid);
      return;
    }
    if (e.kind === 'enter') {
      if (e.id === EXIT) return void this.leaveSub(scoreLevel(cur.level).cleared && this.canEdit());
      const v = this.views.get(e.id);
      if (!v || cur.sub) return;
      if (v.entity.kind === 'warp') void this.enterPipe(e.id);
      else if (v.entity.kind === 'cloud' && this.refTarget(v.item)) void this.rideCloud(e.id);
      return;
    }
    // Bump, stomp or collect: that item's done.
    this.played.add(e.id);
    const v = this.views.get(e.id);
    if (!v) return;
    if (this.canEdit()) {
      track('play_complete', { how: e.kind });
      this.setStatus(e.id, 'done');
      return;
    }
    // Read-only: the same show, nothing saved.
    const { entity: en } = v;
    const topY = GROUND_Y - (en.y + en.h) * TILE;
    if (e.kind === 'bump') {
      if (v.top) {
        this.tweens.killTweensOf(v.top);
        (v.top as Phaser.GameObjects.Image).setTexture('used').setY(0);
        this.tweens.add({ targets: v.top, y: -4, yoyo: true, duration: 90 });
      }
      this.popCoin(en.x * TILE + TILE / 2, topY);
    } else if (e.kind === 'stomp') {
      v.root.setVisible(false);
      this.poof(en.x * TILE + TILE / 2, GROUND_Y - 8);
    } else {
      v.root.setVisible(false);
      for (let i = 0; i < 3; i++) this.popCoin(en.x * TILE + i * TILE + 8, topY, i * 80);
    }
  }

  /**
   * Touched the pole with every must-do step ticked (the physics whacks you
   * back otherwise): grab it where you are, slide down, into the castle.
   */
  private touchFlag(body: Body) {
    const level = this.current()?.level;
    if (!level) return;
    this.body = undefined;
    this.leaving = true;
    this.hero.setPosition(this.hero.x, Math.round(body.y + body.h));
    void (async () => {
      await this.finale(level);
      this.wasCleared = true;
      this.leaving = false;
      // Stopped mid-finale: nothing will emit, so finish up here.
      if (this.app.playing) this.app.setPlaying(false, 'cleared');
      else this.exitPlay();
    })();
  }

  /**
   * The pole fights back: it bends away, whips forward (the physics has
   * already knocked the hero back) and tells him off.
   */
  private whack(left: number) {
    track('play_complete', { how: 'whack' });
    this.hero.setTint(0xf6757a);
    this.time.delayedCall(180, () => this.hero.clearTint());
    this.say(poleQuip(left, this.lastPoleQuip));
    const pole = this.pole;
    if (!pole || reducedMotion()) return;
    this.cameras.main.shake(140, 0.004);
    const n = pole.segs.length;
    const bend = { v: 0 };
    const flagX = pole.flag.x - pole.x;
    const flagY = pole.flag.y;
    const apply = () => {
      // Each section turns a little more than the one below: a curve, not a tilt.
      pole.segs.forEach((seg, i) => seg.setRotation(bend.v * 0.07 * ((i + 1) / n)));
      // The flag rides along with the section it hangs from.
      const i = Phaser.Math.Clamp(Math.floor((pole.base - flagY) / TILE), 0, n - 1);
      const seg = pole.segs[i];
      const p = seg.getWorldTransformMatrix().transformPoint(flagX, flagY - (pole.base - i * TILE), new Phaser.Math.Vector2());
      const angle = pole.segs.slice(0, i + 1).reduce((a, sg) => a + sg.rotation, 0);
      pole.flag.setPosition(p.x, p.y).setRotation(angle);
    };
    this.tweens.chain({
      tweens: [
        { targets: bend, v: 1, duration: 110, ease: 'Quad.out', onUpdate: apply },
        { targets: bend, v: -1.6, duration: 90, ease: 'Quad.in', onUpdate: apply },
        { targets: bend, v: 0, duration: 700, ease: 'Elastic.out', onUpdate: apply, onComplete: apply },
      ],
    });
    this.tweens.add({ targets: pole.flag, scaleX: 0.6, yoyo: true, repeat: 3, duration: 90 });
  }

  /** A speech bubble from the top of the flagpole that goes away on its own. */
  private say(line: string) {
    this.lastPoleQuip = line;
    this.poleSpeech?.destroy();
    const pole = this.pole;
    if (!pole) return;
    const t = this.text(0, 0, line, 4, '#1a1c2c', 90).setOrigin(0.5, 1).setStroke('#ffffff', 0);
    const w = Math.ceil(t.displayWidth) + 10;
    const hgt = Math.ceil(t.displayHeight) + 8;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1).fillRoundedRect(-w / 2, -hgt, w, hgt, 3);
    g.lineStyle(1, 0x1a1c2c, 1).strokeRoundedRect(-w / 2, -hgt, w, hgt, 3);
    // Tail down-right, towards the pole top.
    g.fillStyle(0xffffff, 1).fillTriangle(w / 2 - 14, -1, w / 2 - 6, -1, w / 2 - 2, 6);
    g.lineStyle(1, 0x1a1c2c, 1).lineBetween(w / 2 - 14, 0, w / 2 - 2, 6).lineBetween(w / 2 - 6, 0, w / 2 - 2, 6);
    t.setPosition(0, -4);
    const top = pole.base - POLE_H * TILE - 8;
    const box = this.add.container(pole.x - w / 2 + 2, top, [g, t]).setDepth(160);
    this.poleSpeech = box;
    if (!reducedMotion()) {
      box.setScale(0.6);
      this.tweens.add({ targets: box, scale: 1, duration: 140, ease: 'Back.out' });
    }
    this.time.delayedCall(2600, () => {
      if (this.poleSpeech !== box) return;
      this.tweens.add({ targets: box, alpha: 0, duration: 200, onComplete: () => box.destroy() });
      this.poleSpeech = undefined;
    });
  }

  // ---- Animation ----

  private idle() {
    this.hero.anims.stop();
    this.hero.anims.timeScale = 1;
    this.hero.setTexture(this.heroTex());
  }

  private async walkTo(x: number): Promise<void> {
    // Up the stairs: hop down before walking anywhere.
    if (!this.playing && this.hero.y < GROUND_Y - 1) await this.toGround();
    return new Promise((resolve) => {
      const dist = Math.abs(x - this.hero.x);
      if (dist < 1) return resolve();
      if (!this.following) {
        this.following = true;
        this.cameras.main.startFollow(this.hero, true, 0.08, 0.08, -this.viewWidth / 6, 0);
      }
      this.hero.setFlipX(x < this.hero.x);
      this.hero.play(heroWalk(this.app.heroId));
      this.tweens.add({
        targets: this.hero,
        x,
        duration: (dist / TILE / WALK_TILES_PER_SEC) * 1000,
        onComplete: () => {
          this.hero.setFlipX(false);
          this.idle();
          resolve();
        },
      });
    });
  }

  private jump(height = 22): Promise<void> {
    return new Promise((resolve) => {
      this.hero.setTexture(this.heroTex('jump'));
      this.tweens.add({
        targets: this.hero,
        y: GROUND_Y - height,
        duration: 180,
        yoyo: true,
        ease: 'Quad.out',
        onComplete: () => {
          this.idle();
          resolve();
        },
      });
    });
  }

  private async animate(level: Level, changed: Item[], crit: Level['successCriteria'] = []) {
    await this.busy;
    this.busy = this.runAnimations(level, changed, crit);
    await this.busy;
  }

  private async runAnimations(level: Level, changed: Item[], crit: Level['successCriteria'] = []) {
    const cleared = scoreLevel(level).cleared;
    for (const item of changed) {
      const v = this.views.get(item.id);
      if (!v) continue;
      const e = v.entity;
      const cx = e.x * TILE + (e.w * TILE) / 2;
      const topY = GROUND_Y - (e.y + e.h) * TILE;
      if (item.status === 'done') {
        if (e.kind === 'qblock') {
          if (!this.playing && Math.abs(this.hero.x - e.x * TILE) < TILE * 2) await this.jump();
          if (v.top) this.tweens.add({ targets: v.top, y: -4, yoyo: true, duration: 90 });
          this.popCoin(cx, topY);
        } else if (e.kind === 'wall') this.crumble(e);
        else if (e.kind === 'critter') this.poof(cx, GROUND_Y - 8);
        else if (e.kind === 'pipe' || e.kind === 'warp' || e.kind === 'cloud') this.poof(cx, topY - 8);
        else if (e.kind === 'checkpoint' && v.flag) {
          const y = v.flag.y;
          v.flag.y = (e.h - 1) * TILE - 4;
          this.tweens.add({ targets: v.flag, y, duration: 500, ease: 'Quad.out' });
        } else if (e.kind === 'sign' && v.top) this.tweens.add({ targets: v.top, scaleX: 0, yoyo: true, duration: 120 });
        else if (e.kind === 'coins') for (let i = 0; i < 3; i++) this.popCoin(e.x * TILE + i * TILE + 8, topY, i * 80);
      } else if (item.status === 'dropped') this.poof(cx, topY + (e.h * TILE) / 2);
    }

    const sub = this.current()?.sub;
    if (this.leaving || this.playing) this.lightAll();
    if (this.leaving) return;
    // Playing: the player walks to the exit pipe or flagpole themselves.
    if (this.playing) {
      this.wasCleared = cleared;
      return;
    }
    if (sub) {
      // Clearing the last step takes the hero back up the pipe, dependency closed.
      const wasCleared = this.wasCleared;
      this.wasCleared = cleared;
      if (cleared && !wasCleared && !isResolved(sub.dep) && this.canEdit()) return this.leaveSub(true);
      await this.walkTo(this.layout.hero.x * TILE);
      this.autoBubble();
      return;
    }
    if (cleared && !this.wasCleared) {
      // Up the stairs to the step just ticked, then the leap to the pole.
      const ticked = crit.filter((c) => c.done).at(-1);
      await this.climbTo(ticked ? this.stepIndex(ticked.id) : this.topReachable());
      await this.finale(level);
    } else {
      if (!cleared && this.wasCleared) {
        this.hero.setVisible(true).setPosition(this.layout.castleX * TILE, GROUND_Y);
        this.perch = undefined;
      }
      for (const c of crit) {
        if (!c.done) await this.stepOff(this.stepIndex(c.id));
        // A bonus ticked after clearing: the hero's in the castle, the step just lights.
        else if (this.hero.visible) await this.climbTo(this.stepIndex(c.id));
        else this.lightStep(c.id);
      }
      // Still things to do first: back to them after a moment on the step.
      if (crit.some((c) => c.done) && this.layout.hero.kind !== 'flag') await this.pause(350);
    }
    this.lightAll();
    this.wasCleared = cleared;
    if (!cleared) {
      // Waiting at the goal: up the stairs is as good a spot as any.
      if (!(this.layout.hero.kind === 'flag' && this.perch !== undefined)) await this.walkTo(this.layout.hero.x * TILE);
      this.autoBubble();
    }
  }

  // ---- Stairs ----

  private pause(ms: number) {
    return new Promise<void>((resolve) => this.time.delayedCall(ms, resolve));
  }

  private stepIndex(criterionId: string): number | undefined {
    return this.steps.get(criterionId)?.step.index;
  }

  private ticked(i: number) {
    const st = this.layout.stairs[i];
    return !!st && this.current()?.level.successCriteria.find((c) => c.id === st.criterionId)?.done === true;
  }

  /** The highest ticked step (the hero can hop between ticked ones, gaps and all). */
  private topReachable(): number | undefined {
    for (let i = this.layout.stairs.length - 1; i >= 0; i--) if (this.ticked(i)) return i;
  }

  /** Where the hero stands on step `i`, and where he waits at the foot of the stairs. */
  private stepSpot(i: number) {
    const st = this.layout.stairs[i];
    return { x: Math.round((st.x + st.w / 2) * TILE - this.hero.width / 2), y: GROUND_Y - st.h * TILE };
  }

  private footX() {
    return this.layout.stops.at(-1)?.kind === 'flag' ? this.layout.stops.at(-1)!.x * TILE : ((this.layout.stairs[0]?.x ?? this.layout.flagX) - 1.5) * TILE;
  }

  /**
   * Up to step `k`: to the foot of the stairs, then hop by hop up the ticked
   * steps below it (skipping un-ticked gaps), and onto `k`, which lights up.
   */
  private async climbTo(k: number | undefined) {
    if (k === undefined) return;
    const st = this.layout.stairs[k];
    if (!st) return;
    const id = st.criterionId;
    if (reducedMotion()) {
      const spot = this.stepSpot(k);
      this.tweens.killTweensOf(this.hero);
      this.hero.setVisible(true).setAlpha(1).setPosition(spot.x, spot.y);
      this.perch = k;
      this.lightStep(id);
      return;
    }
    if (this.perch === undefined) await this.approach(this.footX());
    const from = this.perch ?? -1;
    const path = from < k ? this.layout.stairs.map((_, i) => i).filter((i) => i > from && i < k && this.ticked(i)) : [];
    for (const i of [...path, k]) {
      const spot = this.stepSpot(i);
      await this.hopTo(spot.x, spot.y, 260);
      this.perch = i;
    }
    this.lightStep(id);
  }

  /** Step `k` was unticked: if the hero's on it, down to the next ticked step below, or the ground. */
  private async stepOff(k: number | undefined) {
    if (k === undefined || this.perch !== k) return;
    let below: number | undefined;
    for (let i = k - 1; i >= 0; i--) if (this.ticked(i)) (below = i), (i = -1);
    if (below === undefined) return this.toGround();
    const spot = this.stepSpot(below);
    if (reducedMotion()) this.hero.setPosition(spot.x, spot.y);
    else await this.hopTo(spot.x, spot.y, 260);
    this.perch = below;
  }

  /** Off the stairs (or down from wherever play mode left him) onto the ground. */
  private async toGround() {
    const wasUp = this.perch !== undefined;
    this.perch = undefined;
    if (this.hero.y >= GROUND_Y - 1) return;
    const L = this.layout;
    // Over the stairs: down at their foot rather than into a step.
    const overStairs = wasUp || (L.stairs.length > 0 && this.hero.x + this.hero.width > L.stairs[0].x * TILE && this.hero.x < L.flagX * TILE);
    const x = overStairs ? this.footX() : this.hero.x;
    if (reducedMotion()) this.hero.setPosition(x, GROUND_Y);
    else await this.hopTo(x, GROUND_Y, 300);
  }

  // ---- Pipes and clouds ----

  /** Hops from the ground onto a platform whose top is at `y`, landing at `x`. */
  private hopTo(x: number, y: number, duration = 320): Promise<void> {
    return new Promise((resolve) => {
      this.hero.setTexture(this.heroTex('jump'));
      const startY = this.hero.y;
      const peak = Math.min(startY, y) - 18;
      this.tweens.add({ targets: this.hero, x, duration, ease: 'Linear' });
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration,
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0;
          // Parabola through start, peak and end.
          const a = 1 - t;
          this.hero.y = a * a * startY + 2 * a * t * peak + t * t * y;
        },
        onComplete: () => {
          this.hero.y = y;
          this.idle();
          resolve();
        },
      });
    });
  }

  /**
   * Gets the hero to `x` quickly: a short walk, or (when he's far off or
   * already inside the castle) popping up just short of it first.
   */
  private async approach(x: number) {
    if (!this.hero.visible || Math.abs(this.hero.x - x) > 6 * TILE) {
      this.hero.setPosition(x - 2 * TILE, GROUND_Y).setVisible(true).setAlpha(0);
      this.tweens.add({ targets: this.hero, alpha: 1, duration: 150 });
      this.following = false;
    }
    await this.walkTo(x);
  }

  /** Down the warp pipe into the dependency's sub-level. */
  private async enterPipe(itemId: string) {
    const cur = this.current();
    const v = this.views.get(itemId);
    if (!cur || !v || this.leaving) return;
    this.leaving = true;
    this.closeBubble();
    await this.busy;
    const e = v.entity;
    const steps = v.item.subtasks?.length ?? 0;
    track('warp_enter', { steps_bucket: bucket(steps), adding: steps === 0 });
    const mouth = GROUND_Y - e.h * TILE;
    const x = e.x * TILE + (e.w * TILE - this.hero.width) / 2;
    await this.getOnto(e.x * TILE - TILE, x, mouth);
    v.top?.setVisible(false);
    await this.sink(TILE * 2);
    this.app.arrival = { kind: 'pipe-down' };
    go({ view: 'level', projectId: cur.projectId, worldId: cur.world.id, levelId: cur.level.id, subId: itemId });
  }

  /** Out of a sub-level, up the exit pipe; `close` marks the dependency done on the way. */
  private async leaveSub(close: boolean) {
    const cur = this.current();
    const pipe = this.exitPipe;
    if (!cur?.sub || !pipe || this.leaving) return;
    this.leaving = true;
    this.closeBubble();
    const dep = cur.sub.dep;
    track('warp_exit', { closed: close && !isResolved(dep) });
    await this.getOnto(pipe.x - TILE, pipe.x + (pipe.w - this.hero.width) / 2, pipe.top);
    await this.sink(TILE * 2);
    if (close && !isResolved(dep))
      this.app.dispatch({ kind: 'setItemStatus', projectId: cur.projectId, worldId: cur.world.id, levelId: cur.level.id, itemId: dep.id, status: 'done' });
    this.app.arrival = { kind: 'pipe-up', itemId: dep.id };
    go({ view: 'level', projectId: cur.projectId, worldId: cur.world.id, levelId: cur.level.id });
  }

  /** Jumps on the cloud and floats off to the level the dependency points at. */
  private async rideCloud(itemId: string) {
    const v = this.views.get(itemId);
    const target = v && this.refTarget(v.item);
    const cur = this.current();
    if (!cur || !v || !target || this.leaving) return;
    this.leaving = true;
    this.closeBubble();
    await this.busy;
    const e = v.entity;
    const cloudTop = GROUND_Y - (e.y + e.h) * TILE + 2;
    track('cloud_ride');
    this.tweens.killTweensOf(v.top!);
    await this.getOnto(e.x * TILE - TILE, e.x * TILE + TILE, cloudTop);
    this.cameras.main.stopFollow();
    this.following = false;
    await new Promise<void>((resolve) =>
      this.tweens.add({
        targets: [v.root, this.hero],
        x: `+=${this.viewWidth}`,
        y: `-=${GROUND_Y}`,
        duration: 1100,
        ease: 'Quad.in',
        onComplete: () => resolve(),
      }),
    );
    this.app.arrival = { kind: 'cloud' };
    go({ view: 'level', projectId: cur.projectId, worldId: target.worldId, levelId: target.levelId });
  }

  /**
   * Gets the hero on top of a pipe or cloud at (`x`, `top`): walking up to
   * `from` and hopping on, or (when playing, already up there) shuffling over.
   */
  private async getOnto(from: number, x: number, top: number) {
    if (this.playing && Math.abs(this.hero.y - top) < 4) {
      this.hero.y = top;
      await new Promise<void>((resolve) => this.tweens.add({ targets: this.hero, x, duration: 120, onComplete: () => resolve() }));
      this.idle();
      return;
    }
    await this.approach(from);
    await this.hopTo(x, top);
  }

  /** Slides the hero down behind the scenery (into a pipe), then fades out. */
  private sink(depth: number): Promise<void> {
    return new Promise((resolve) => {
      this.hero.setDepth(-1);
      this.tweens.add({ targets: this.hero, y: this.hero.y + depth, duration: 500, ease: 'Linear' });
      this.cameras.main.fadeOut(520, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => resolve());
    });
  }

  /** Entrance after a warp or a cloud ride. */
  private async arrive(a: NonNullable<App['arrival']>) {
    const cam = this.cameras.main;
    this.hero.setVisible(true);
    const stopX = this.layout.hero.x * TILE;
    if (a.kind === 'pipe-down') {
      // Drop out of the ceiling pipe.
      this.hero.setPosition(TILE + 8, 3 * TILE + 4).setTexture(this.heroTex('jump'));
      await new Promise<void>((resolve) =>
        this.tweens.add({ targets: this.hero, y: GROUND_Y, duration: 520, ease: 'Bounce.out', onComplete: () => resolve() }),
      );
      this.idle();
      if (this.wasCleared && !this.current()?.sub) return this.fadeHero();
      await this.walkTo(stopX);
      return;
    }
    if (a.kind === 'pipe-up') {
      // Rise out of the dependency's pipe, then hop down and carry on.
      const v = a.itemId ? this.views.get(a.itemId) : undefined;
      if (!v) return;
      const e = v.entity;
      const mouth = GROUND_Y - e.h * TILE;
      this.hero.setDepth(-1).setPosition(e.x * TILE + (e.w * TILE - this.hero.width) / 2, mouth + 2 * TILE);
      cam.stopFollow();
      cam.centerOn(this.hero.x + TILE, WORLD_H / 2);
      await new Promise<void>((resolve) =>
        this.tweens.add({ targets: this.hero, y: mouth, duration: 600, delay: 200, ease: 'Linear', onComplete: () => resolve() }),
      );
      this.hero.setDepth(40);
      await this.hopTo((e.x + e.w) * TILE + 4, GROUND_Y);
      this.following = false;
      // A cleared level's hero lives in the castle: wave goodbye.
      if (this.wasCleared) return this.fadeHero();
      await this.walkTo(stopX);
      return;
    }
    // Cloud: float in from the top left and hop off by the first stop.
    const cloud = this.add.image(0, 0, 'cloud-ride').setOrigin(0, 0).setScale(1.5).setDepth(39);
    const landX = Math.max(TILE * 2, stopX - TILE * 2);
    const by = GROUND_Y - 3 * TILE;
    cloud.setPosition(landX - this.viewWidth / 2, -TILE * 3);
    this.hero.setPosition(cloud.x + TILE, cloud.y + 2);
    cam.stopFollow();
    cam.centerOn(landX, WORLD_H / 2);
    await new Promise<void>((resolve) =>
      this.tweens.add({
        targets: [cloud, this.hero],
        x: `+=${landX - cloud.x}`,
        y: `+=${by - cloud.y}`,
        duration: 1000,
        ease: 'Quad.out',
        onComplete: () => resolve(),
      }),
    );
    await this.hopTo(landX + TILE * 2, GROUND_Y);
    this.tweens.add({ targets: cloud, x: cloud.x - this.viewWidth, y: -TILE * 4, duration: 900, ease: 'Quad.in', onComplete: () => cloud.destroy() });
    this.following = false;
    if (this.wasCleared && !this.current()?.sub) return this.fadeHero();
    await this.walkTo(stopX);
  }

  private fadeHero(): Promise<void> {
    return new Promise((resolve) =>
      this.tweens.add({
        targets: this.hero,
        alpha: 0,
        delay: 300,
        duration: 300,
        onComplete: () => {
          this.hero.setVisible(false).setAlpha(1);
          resolve();
        },
      }),
    );
  }

  private popCoin(x: number, y: number, delay = 0) {
    const c = this.add.image(x, y, 'coin').setOrigin(0.5, 1);
    this.fx.add(c);
    this.tweens.add({ targets: c, y: y - 28, alpha: 0, duration: 600, delay, ease: 'Quad.out', onComplete: () => c.destroy() });
    const t = this.text(x, y - 10, '+1', 4, '#fee761').setOrigin(0.5, 1);
    this.fx.add(t);
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 800, delay, onComplete: () => t.destroy() });
  }

  private crumble(e: LayoutEntity) {
    for (let i = 0; i < 8; i++) {
      const b = this.add.image(e.x * TILE + 8, GROUND_Y - (1 + (i % 3)) * TILE, 'brick').setScale(0.35);
      this.fx.add(b);
      this.tweens.add({
        targets: b,
        x: b.x + Phaser.Math.Between(-30, 30),
        y: b.y + Phaser.Math.Between(-30, -10),
        angle: Phaser.Math.Between(-180, 180),
        duration: 300,
        ease: 'Quad.out',
        onComplete: () =>
          this.tweens.add({ targets: b, y: GROUND_Y + 40, alpha: 0, duration: 400, ease: 'Quad.in', onComplete: () => b.destroy() }),
      });
    }
    this.cameras.main.shake(150, 0.004);
  }

  private poof(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const s = this.add.image(x, y, 'sparkle').setScale(0.6);
      this.fx.add(s);
      const a = (i / 6) * Math.PI * 2;
      this.tweens.add({ targets: s, x: x + Math.cos(a) * 16, y: y + Math.sin(a) * 16, alpha: 0, duration: 450, onComplete: () => s.destroy() });
    }
  }

  /**
   * The end of the level: leap from wherever the hero is onto the pole,
   * catching it at that height, slide down as the flag goes up, hop off,
   * run into the castle, fireworks.
   */
  private async finale(level: Level) {
    const L = this.layout;
    const fx = L.flagX * TILE;
    const grabX = fx - TILE + 6;
    const pending = this.flagPending;
    this.flagPending = undefined;
    this.perch = undefined;
    if (reducedMotion()) {
      if (pending?.img.active) pending.img.setY(pending.y);
      this.hero.setVisible(false).setPosition(L.castleX * TILE + 32, GROUND_Y);
      this.fireworks(level);
      return;
    }
    this.hero.setVisible(true).setAlpha(1);
    // Catch the pole at the height he's at: higher step, higher catch.
    const grabY = Phaser.Math.Clamp(this.hero.y, GROUND_Y - (POLE_H - 1) * TILE, GROUND_Y);
    if (Math.abs(this.hero.x - grabX) > 1 || Math.abs(this.hero.y - grabY) > 1) await this.hopTo(grabX, grabY, 300);
    this.hero.anims.stop();
    this.hero.setFlipX(false).setTexture(this.heroTex('jump'));
    const slide = Math.max(250, (GROUND_Y - this.hero.y) * 6);
    if (pending?.img.active) this.tweens.add({ targets: pending.img, y: pending.y, duration: slide, ease: 'Quad.out' });
    await new Promise<void>((resolve) => this.tweens.add({ targets: this.hero, y: GROUND_Y, duration: slide, ease: 'Quad.in', onComplete: () => resolve() }));
    this.idle();
    await this.pause(120);
    // Hop off over the base block and run for the castle.
    await this.hopTo(fx + TILE + 4, GROUND_Y, 300);
    await this.walkTo(L.castleX * TILE + 32);
    this.tweens.add({ targets: this.hero, alpha: 0, duration: 300, onComplete: () => this.hero.setVisible(false).setAlpha(1) });
    this.fireworks(level);
  }

  private fireworks(level: Level) {
    const L = this.layout;
    if (!reducedMotion())
      for (let i = 0; i < 5; i++)
        this.time.delayedCall(200 + i * 250, () => {
          const x = L.castleX * TILE + Phaser.Math.Between(0, 80);
          const y = Phaser.Math.Between(40, 100);
          for (let k = 0; k < 10; k++) {
            const s = this.add.image(x, y, k % 2 ? 'sparkle' : 'star').setScale(0.4);
            this.fx.add(s);
            const a = (k / 10) * Math.PI * 2;
            this.tweens.add({ targets: s, x: x + Math.cos(a) * 26, y: y + Math.sin(a) * 26, alpha: 0, duration: 700, onComplete: () => s.destroy() });
          }
        });
    const sc = scoreLevel(level);
    if (!sc.cleared) return toast('LEVEL CLEAR! (Read-only: nothing was saved.)', 'win', 5000);
    toast(`LEVEL CLEAR! ${'★'.repeat(sc.stars)}${'☆'.repeat(3 - sc.stars)} +${sc.xp} XP — on to the next one.`, 'win', 6000);
  }

}
