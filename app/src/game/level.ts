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
  type World,
} from '@quest/shared';
import { THEMES } from '../sprites/pixels';
import { TILE, type ThemeKey } from '../sprites/render';
import { toast } from '../ui/toast';
import { itemForm, STATUS_LABEL, TYPE_INFO } from '../ui/forms';
import { itemAddr, type App } from '../app';
import { go } from '../router';
import { GROUND_Y, heroWalk, QuestScene, tex, WORLD_H } from './common';

export interface LevelParams {
  projectId: string;
  worldId: string;
  levelId: string;
  /** Dependency whose sub-level is shown. */
  subId?: string;
  pr?: number;
}

/** Bubble id for a sub-level's exit pipe (not an item; ids can't contain '!'). */
const EXIT = '!exit';

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
  private bubble?: { itemId: string; box: Phaser.GameObjects.Container; auto: boolean };
  /** Hero-stop item whose auto bubble the user closed; stays closed until the hero moves on. */
  private dismissedAuto?: string;
  /** Criteria ticked per level at the last render, to animate the flag between states. */
  private flagDone = new Map<string, number>();
  private skyGfx?: Phaser.GameObjects.Graphics;
  /** Parallax layers live outside `stage`: containers ignore child scrollFactor. */
  private parallax: Phaser.GameObjects.Image[] = [];
  /** A sub-level's exit pipe, in pixels. */
  private exitPipe?: { x: number; w: number; top: number };
  /** Set while the hero is warping or riding away, so nothing else moves him. */
  private leaving = false;
  private sig = '';

  constructor() {
    super('level');
  }

  init(params: LevelParams) {
    super.init();
    this.app.bubbleOpen = false;
    this.params = params;
    this.views.clear();
    this.prev.clear();
    this.stage = undefined;
    this.sig = '';
    this.bubble = undefined;
    this.dismissedAuto = undefined;
    this.exitPipe = undefined;
    this.leaving = false;
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
    this.wasCleared = scoreLevel(cur.level).cleared;
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
    this.watch(() => this.refresh());

    // Clicking empty space, or Esc, closes the bubble; Enter completes the item.
    this.input.on('pointerup', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (!this.dragged && over.length === 0) this.closeBubble();
    });
    const typing = () => !!document.activeElement?.matches('input, textarea, select, [contenteditable]');
    this.input.keyboard?.on('keydown-ESC', () => !typing() && this.closeBubble());
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (typing() || !this.bubble || !this.canEdit()) return;
      this.setStatus(this.bubble.itemId, 'done');
    });

    // A deep-linked item gets its bubble; otherwise show the one the hero waits at.
    // Wait one frame so the camera has settled on the hero.
    this.time.delayedCall(0, async () => {
      if (arrival) {
        this.busy = this.arrive(arrival);
        await this.busy;
      }
      if (!this.syncBubbleToSelection()) this.autoBubble();
    });
  }

  protected onResize() {
    super.onResize();
    const cur = this.current();
    if (cur) this.build(cur.world, cur.level, cur.diff);
  }

  private refresh() {
    const cur = this.current();
    if (!cur) return;
    const sig = JSON.stringify([cur.level, cur.diff?.change, this.app.selection]);
    if (sig === this.sig) return;
    const changed = this.diffStatuses(cur.level);
    this.build(cur.world, cur.level, cur.diff);
    // Keep an open bubble in step with its item (it moves when the layout does),
    // and with the selection, which the URL can change.
    if (!this.syncBubbleToSelection() && this.bubble) {
      const item = cur.level.items.find((i) => i.id === this.bubble!.itemId);
      if (this.bubble.itemId === EXIT) this.openBubble(EXIT, { pop: false, auto: this.bubble.auto });
      else if (!item || item.status === 'done') this.closeBubble();
      else this.openBubble(item.id, { pop: false, auto: this.bubble.auto });
    }
    void this.animate(cur.level, changed);
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
    this.sig = JSON.stringify([level, diff?.change, this.app.selection]);
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
    const poleH = 9;
    if (sub) this.drawUnderground(stage, level, fx, cleared);
    else this.drawGoal(stage, level, fx, poleH, cleared);

    // Items.
    const byId = new Map(level.items.map((i) => [i.id, i]));
    for (const e of L.entities) {
      const item = byId.get(e.itemId);
      if (item) this.drawEntity(stage, e, item, diff);
    }

    // Selection highlight.
    const sel = this.app.selection;
    if (sel?.kind === 'item') {
      const v = this.views.get(sel.id);
      if (v) this.highlight(stage, v.entity, 0xfee761);
    }
    if (sel?.kind === 'criteria' && !sub) this.highlight(stage, { x: L.flagX - 0.5, y: 0, w: 2, h: poleH + 1 } as LayoutEntity, 0xfee761);

    this.prev = new Map(level.items.map((i) => [i.id, i.status]));
  }

  /** Flagpole + castle at the end of a normal level. */
  private drawGoal(stage: Phaser.GameObjects.Container, level: Level, fx: number, poleH: number, cleared: boolean) {
    const L = this.layout;
    stage.add(this.add.image(fx, GROUND_Y - TILE, 'used').setOrigin(0, 0));
    for (let i = 1; i < poleH; i++) stage.add(this.add.image(fx, GROUND_Y - TILE - i * TILE, 'pole').setOrigin(0, 0));
    stage.add(this.add.image(fx, GROUND_Y - TILE - poleH * TILE, 'pole-top').setOrigin(0, 0));
    const poleHit = this.add.zone(fx - 8, GROUND_Y - (poleH + 1) * TILE, 3 * TILE, (poleH + 1) * TILE).setOrigin(0, 0);
    this.clickable(poleHit, () => this.app.select({ kind: 'criteria' }));
    stage.add(poleHit);
    this.drawCriteria(stage, level, fx, poleH, cleared);
    stage.add(this.add.image(L.castleX * TILE, GROUND_Y, 'castle').setOrigin(0, 1));
    if (cleared) stage.add(this.add.image(L.castleX * TILE + 36, GROUND_Y - 88, 'flag').setOrigin(0, 0));
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

  /**
   * The pole is split into one section per success criterion, bottom to top,
   * each with a label bubble. The flag climbs one section per ticked criterion
   * and reaches the top when they're all done.
   */
  private drawCriteria(stage: Phaser.GameObjects.Container, level: Level, fx: number, poleH: number, cleared: boolean) {
    const criteria = level.successCriteria;
    const n = Math.max(1, criteria.length);
    const done = criteria.filter((c) => c.done).length;
    const base = GROUND_Y - TILE; // top of the base block
    const top = GROUND_Y - TILE - (poleH - 1) * TILE + 2; // just under the ball
    const section = (base - top) / n;
    const poleX = fx + 8;

    // Section marks on the pole.
    const marks = this.add.graphics();
    marks.fillStyle(0xfee761, 1);
    for (let i = 1; i < n; i++) marks.fillRect(poleX - 3, Math.round(base - i * section), 6, 1);
    stage.add(marks);

    // Flag: bottom with nothing ticked, top with everything ticked.
    const flagAt = (k: number) => Math.round(base - 9 - ((base - 9 - top) * k) / n);
    const flag = this.add.image(fx - 10, flagAt(done), cleared ? 'flag' : 'flag-grey').setOrigin(0, 0).setFlipX(true);
    stage.add(flag);
    const prev = this.flagDone.get(level.id);
    if (prev !== undefined && prev !== done) {
      flag.y = flagAt(prev);
      this.tweens.add({ targets: flag, y: flagAt(done), duration: 600, ease: done > prev ? 'Back.out' : 'Quad.out' });
    }
    this.flagDone.set(level.id, done);

    // A label bubble per criterion, at the middle of its section.
    const edit = this.canEdit();
    const cur = this.current();
    const fontSize = section >= 14 ? 3.5 : 3;
    const h = Math.max(7, Math.min(13, Math.floor(section) - 2));
    const maxW = (this.layout.castleX - this.layout.flagX) * TILE - 26;
    criteria.forEach((c, i) => {
      const cy = Math.round(base - (i + 0.5) * section);
      const box = this.add.container(poleX + 9, cy);
      const box6 = Math.min(6, h - 3);
      const label = this.text(box6 + 6, 0, c.text, fontSize, c.done ? '#5a6988' : '#1a1c2c').setOrigin(0, 0.5).setStroke('#ffffff', 0);
      // Single line: trim to fit.
      let txt = c.text;
      while (label.displayWidth > maxW - box6 - 10 && txt.length > 4) {
        txt = txt.slice(0, -2);
        label.setText(`${txt.trimEnd()}...`);
      }
      const w = Math.ceil(label.displayWidth) + box6 + 10;
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1).fillRoundedRect(0, -h / 2, w, h, 2);
      g.lineStyle(1, 0x1a1c2c, 1).strokeRoundedRect(0, -h / 2, w, h, 2);
      // Tail to the pole.
      g.fillStyle(0xffffff, 1).fillTriangle(0.5, -2, 0.5, 2, -5, 0);
      g.lineStyle(1, 0x1a1c2c, 1).lineBetween(0, -2, -5, 0).lineBetween(-5, 0, 0, 2);
      if (c.mvp) g.fillStyle(0xe43b44, 1).fillRect(1, -h / 2 + 1, 2, h - 2);
      // Checkbox.
      const bx = 4;
      g.fillStyle(c.done ? 0x63c74d : 0xffffff, 1).fillRect(bx, -box6 / 2, box6, box6);
      g.lineStyle(1, 0x1a1c2c, 1).strokeRect(bx, -box6 / 2, box6, box6);
      if (c.done) g.lineStyle(1.2, 0xffffff, 1).lineBetween(bx + 1.2, 0, bx + box6 / 2 - 0.5, box6 / 2 - 1.2).lineBetween(bx + box6 / 2 - 0.5, box6 / 2 - 1.2, bx + box6 - 1, -box6 / 2 + 1.2);
      box.add([g, label]);
      const hit = this.add.zone(-5, -h / 2, w + 5, h).setOrigin(0);
      box.add(hit);
      hit.setInteractive({ useHandCursor: edit });
      hit.on('pointerover', () => this.showCriterionTip(c.text, c.mvp, box.x + w / 2, cy - h / 2));
      hit.on('pointerout', () => this.tooltip?.destroy());
      hit.on('pointerup', () => {
        if (this.dragged || !edit || !cur) return;
        this.tooltip?.destroy();
        this.app.dispatch({
          kind: 'setCriterion',
          projectId: cur.projectId,
          worldId: cur.world.id,
          levelId: level.id,
          criterionId: c.id,
          done: !c.done,
        });
      });
      stage.add(box);
    });

    stage.add(
      this.text(poleX, GROUND_Y + 6, `GOAL\n${done}/${criteria.length}`, 4, cleared ? '#63c74d' : '#fee761').setOrigin(0.5, 0),
    );
  }

  private showCriterionTip(text: string, mvp: boolean, x: number, y: number) {
    this.tooltip?.destroy();
    const t = this.text(0, 0, `${text}${mvp ? '\nMVP: needed to clear' : '\nBonus'}`, 4, '#ffffff', 120).setOrigin(0.5, 1);
    const b = t.getBounds();
    const bg = this.add.rectangle(0, 2, b.width + 8, b.height + 6, 0x1a1c2c, 0.92).setOrigin(0.5, 1).setStrokeStyle(1, 0xfee761);
    this.tooltip = this.add.container(x, y - 4, [bg, t]).setDepth(100);
  }

  private highlight(stage: Phaser.GameObjects.Container, e: Pick<LayoutEntity, 'x' | 'y' | 'w' | 'h'>, color: number) {
    const g = this.add.graphics();
    g.lineStyle(1, color, 1);
    g.strokeRect(e.x * TILE - 2, GROUND_Y - (e.y + e.h) * TILE - 2, e.w * TILE + 4, e.h * TILE + 4);
    stage.add(g);
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

  /** Closing an auto bubble remembers it; closing a chosen one clears the selection (and URL). */
  private closeBubble() {
    const b = this.bubble;
    if (!b) return;
    b.box.destroy();
    this.bubble = undefined;
    this.app.bubbleOpen = false;
    if (b.auto) this.dismissedAuto = b.itemId;
    else if (this.app.selection?.kind === 'item' && this.app.selection.id === b.itemId) this.app.select(undefined);
  }

  /** Opens the bubble for the selected item, if any. Returns true when a selection drives it. */
  private syncBubbleToSelection(): boolean {
    const sel = this.app.selection;
    if (sel?.kind !== 'item') {
      if (this.bubble && !this.bubble.auto) {
        this.bubble.box.destroy();
        this.bubble = undefined;
        this.app.bubbleOpen = false;
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
    if (this.leaving) return;
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

    const v = this.views.get(id);
    if (!v) return;
    const { item, entity: e } = v;
    const info = TYPE_INFO[item.type];
    const optional = item.type === 'stretch' || item.mvp === false;
    spec.title = item.title;
    spec.lines.push({ text: `${info.label.toUpperCase()} · ${STATUS_LABEL[item.status].toUpperCase()}${optional ? ' · OPTIONAL' : ''}`, size: 3.5, muted: true });
    if (item.notes) spec.lines.push({ text: item.notes.length > 160 ? `${item.notes.slice(0, 157)}...` : item.notes, size: 4 });
    if (item.dependsOn?.length) {
      const names = item.dependsOn.map((d) => cur.level.items.find((i) => i.id === d)?.title ?? d);
      spec.lines.push({ text: `After: ${names.join(', ')}`, size: 3.5, muted: true });
    }

    const mode = cur.sub ? undefined : dependencyMode(item);
    const resolved = isResolved(item);
    if (mode === 'warp') {
      const steps = (item.subtasks ?? []) as Item[];
      const left = steps.filter((st) => isMvpItem(st) && !isResolved(st)).length;
      spec.lines.push({ text: left ? `Warp pipe: ${left} of ${steps.length} steps to go below.` : `Warp pipe: all ${steps.length} steps done below.`, size: 3.5, muted: true });
      button('WARP IN', 0x63c74d, () => void this.enterPipe(item.id));
    }
    if (mode === 'cloud') {
      const target = this.refTarget(item);
      spec.lines.push({ text: target ? `Cloud to ${target.label}${target.cleared ? ' (cleared)' : ''}` : `Cloud to ${item.levelRef}`, size: 3.5, muted: true });
      if (target) button('HOP ON', 0x8fd3ff, () => void this.rideCloud(item.id));
    }

    if (edit) {
      if (resolved) button(item.status === 'done' ? 'REOPEN' : 'RESTORE', 0xc0cbdc, () => this.setStatus(item.id, 'todo'));
      else if (mode === 'warp' || mode === 'cloud') {
        // Close it (you've got what you needed) or skip it (turns out you don't need it).
        button('GOT IT!', 0xfee761, () => this.setStatus(item.id, 'done'));
        button('JUMP OVER', 0xfeae34, () => this.setStatus(item.id, 'dropped'));
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

    const PAD = 6;
    const GAP = 3;
    const MAX_W = 164;
    const CLOSE = 9;
    const INK = '#1a1c2c';
    const MUTED = '#5a6988';
    const inner = MAX_W - 2 * PAD;
    const box = this.add.container(0, 0).setDepth(150);
    const label = (str: string, size: number, color: string, wrap: number) =>
      this.text(0, 0, str, size, color, wrap).setOrigin(0, 0).setStroke('#ffffff', 0).setAlign('left');

    // 1. Text blocks, wrapped to the widest the bubble may be.
    const title = label(spec.title, 5, INK, inner - CLOSE - 4);
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
    const W = Math.ceil(Phaser.Math.Clamp(contentW + 2 * PAD + 1, 84, MAX_W));

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
      if (!auto && (left < viewX || left + W > viewX + viewW)) {
        this.following = false;
        cam.stopFollow();
        cam.pan(left + W / 2, cam.midPoint.y, 350, 'Sine.easeInOut');
      }
    }
    this.bubble = { itemId, box, auto };
    this.app.bubbleOpen = true;
  }

  // ---- Animation ----

  private idle() {
    this.hero.anims.stop();
    this.hero.setTexture(this.heroTex());
  }

  private walkTo(x: number): Promise<void> {
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

  private async animate(level: Level, changed: Item[]) {
    await this.busy;
    this.busy = this.runAnimations(level, changed);
    await this.busy;
  }

  private async runAnimations(level: Level, changed: Item[]) {
    const cleared = scoreLevel(level).cleared;
    for (const item of changed) {
      const v = this.views.get(item.id);
      if (!v) continue;
      const e = v.entity;
      const cx = e.x * TILE + (e.w * TILE) / 2;
      const topY = GROUND_Y - (e.y + e.h) * TILE;
      if (item.status === 'done') {
        if (e.kind === 'qblock') {
          if (Math.abs(this.hero.x - e.x * TILE) < TILE * 2) await this.jump();
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
    if (this.leaving) return;
    if (sub) {
      // Clearing the last step takes the hero back up the pipe, dependency closed.
      const wasCleared = this.wasCleared;
      this.wasCleared = cleared;
      if (cleared && !wasCleared && !isResolved(sub.dep) && this.canEdit()) return this.leaveSub(true);
      await this.walkTo(this.layout.hero.x * TILE);
      this.autoBubble();
      return;
    }
    if (cleared && !this.wasCleared) await this.celebrate(level);
    else if (!cleared && this.wasCleared) {
      this.hero.setVisible(true);
      this.hero.x = this.layout.castleX * TILE;
    }
    this.wasCleared = cleared;
    if (!cleared) {
      await this.walkTo(this.layout.hero.x * TILE);
      this.autoBubble();
    }
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
    const mouth = GROUND_Y - e.h * TILE;
    const x = e.x * TILE + (e.w * TILE - this.hero.width) / 2;
    await this.approach(e.x * TILE - TILE);
    await this.hopTo(x, mouth);
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
    await this.approach(pipe.x - TILE);
    await this.hopTo(pipe.x + (pipe.w - this.hero.width) / 2, pipe.top);
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
    await this.approach(e.x * TILE - TILE);
    this.tweens.killTweensOf(v.top!);
    await this.hopTo(e.x * TILE + TILE, cloudTop);
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

  private async celebrate(level: Level) {
    const L = this.layout;
    const fx = L.flagX * TILE;
    await this.walkTo(fx - TILE);
    await this.jump(90);
    await this.walkTo(L.castleX * TILE + 32);
    this.tweens.add({ targets: this.hero, alpha: 0, duration: 300, onComplete: () => this.hero.setVisible(false).setAlpha(1) });
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
    toast(`LEVEL CLEAR! ${'★'.repeat(sc.stars)}${'☆'.repeat(3 - sc.stars)} +${sc.xp} XP — on to the next one.`, 'win', 6000);
  }

}
