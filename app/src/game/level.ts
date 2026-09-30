import Phaser from 'phaser';
import {
  layoutLevel,
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
import { GROUND_Y, QuestScene, tex, WORLD_H } from './common';

export interface LevelParams {
  projectId: string;
  worldId: string;
  levelId: string;
  pr?: number;
}

interface View {
  entity: LayoutEntity;
  item: Item;
  root: Phaser.GameObjects.Container;
  flag?: Phaser.GameObjects.Image;
  top?: Phaser.GameObjects.Image;
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
  /** Speech bubble with an item's details and quick actions. */
  private bubble?: { itemId: string; box: Phaser.GameObjects.Container; status: Item['status'] };
  private skyGfx?: Phaser.GameObjects.Graphics;
  /** Parallax layers live outside `stage`: containers ignore child scrollFactor. */
  private parallax: Phaser.GameObjects.Image[] = [];
  private sig = '';

  constructor() {
    super('level');
  }

  init(params: LevelParams) {
    super.init();
    this.params = params;
    this.views.clear();
    this.prev.clear();
    this.stage = undefined;
    this.sig = '';
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
    this.hero = this.add.sprite(0, GROUND_Y, 'hero').setOrigin(0, 1).setDepth(40);
    this.build(cur.world, cur.level, cur.diff);
    this.heroTargetX = this.layout.hero.x * TILE;
    this.hero.x = this.heroTargetX;
    this.wasCleared = scoreLevel(cur.level).cleared;
    if (this.wasCleared) this.hero.setVisible(false);
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
    // Keep an open bubble in step with the item (it moves when the layout does).
    if (this.bubble) {
      const item = cur.level.items.find((i) => i.id === this.bubble!.itemId);
      if (!item || item.status === 'done') this.closeBubble();
      else this.openBubble(item.id, false);
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
    const theme: ThemeKey = this.params.pr ? 'warp' : world.theme;
    const colors = THEMES[theme];
    this.layout = layoutLevel(level);
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
    for (const d of L.decorations.filter((d) => d.kind === 'cloud'))
      this.parallax.push(this.add.image(d.x * TILE, (13 - d.y) * TILE, 'cloud').setScale(0.5 + d.size * 0.25).setScrollFactor(0.4, 1).setAlpha(0.95).setDepth(-90));
    for (const d of L.decorations.filter((d) => d.kind === 'hill'))
      this.parallax.push(this.add.image(d.x * TILE, GROUND_Y, tex('hill', theme)).setOrigin(0, 1).setScale(0.6 + d.size * 0.3).setScrollFactor(0.7, 1).setDepth(-80));
    for (const d of L.decorations.filter((d) => d.kind === 'bush'))
      stage.add(this.add.image(d.x * TILE, GROUND_Y, 'bush').setOrigin(0, 1).setScale(0.4 + d.size * 0.2));

    // Ground.
    const groundW = Math.max(L.width * TILE, this.viewWidth + TILE);
    stage.add(this.add.tileSprite(0, GROUND_Y, groundW, TILE, tex('ground-top', theme)).setOrigin(0, 0));
    stage.add(this.add.tileSprite(0, GROUND_Y + TILE, groundW, this.floor - GROUND_Y - TILE, tex('ground-fill', theme)).setOrigin(0, 0));

    // Flagpole + castle.
    const cleared = scoreLevel(level).cleared;
    const fx = L.flagX * TILE;
    const poleH = 9;
    stage.add(this.add.image(fx, GROUND_Y - TILE, 'used').setOrigin(0, 0));
    for (let i = 1; i < poleH; i++) stage.add(this.add.image(fx, GROUND_Y - TILE - i * TILE, 'pole').setOrigin(0, 0));
    stage.add(this.add.image(fx, GROUND_Y - TILE - poleH * TILE, 'pole-top').setOrigin(0, 0));
    const flagY = cleared ? GROUND_Y - 3 * TILE : GROUND_Y - TILE - (poleH - 1) * TILE;
    const flag = this.add.image(fx - 10, flagY, cleared ? 'flag' : 'flag-grey').setOrigin(0, 0).setFlipX(true);
    stage.add(flag);
    const poleHit = this.add.zone(fx - 8, GROUND_Y - (poleH + 1) * TILE, 3 * TILE, (poleH + 1) * TILE).setOrigin(0, 0);
    this.clickable(poleHit, () => this.app.select({ kind: 'criteria' }));
    stage.add(poleHit);
    const sc = scoreLevel(level);
    stage.add(this.text(fx + 8, GROUND_Y + 6, `GOAL\n${sc.mvpDone}/${sc.mvpTotal} MVP`, 4, cleared ? '#63c74d' : '#fee761').setOrigin(0.5, 0));
    stage.add(this.add.image(L.castleX * TILE, GROUND_Y, 'castle').setOrigin(0, 1));
    if (cleared) stage.add(this.add.image(L.castleX * TILE + 36, GROUND_Y - 88, 'flag').setOrigin(0, 0));

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
    if (sel?.kind === 'criteria') this.highlight(stage, { x: L.flagX - 0.5, y: 0, w: 2, h: poleH + 1 } as LayoutEntity, 0xfee761);

    this.prev = new Map(level.items.map((i) => [i.id, i.status]));
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
    const hit = this.add.zone(0, e.kind === 'pipe' && view.top ? -TILE : 0, e.w * TILE, (e.h + (e.kind === 'pipe' ? 1 : 0)) * TILE).setOrigin(0, 0);
    root.add(hit);
    this.clickable(hit, () => {
      if (this.bubble?.itemId === item.id) {
        this.closeBubble();
        this.app.select(undefined);
        return;
      }
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
    if (status === 'done') this.closeBubble();
    this.app.dispatch({
      kind: 'setItemStatus',
      projectId: cur.projectId,
      worldId: cur.world.id,
      levelId: cur.level.id,
      itemId,
      status,
    });
  }

  private closeBubble() {
    this.bubble?.box.destroy();
    this.bubble = undefined;
  }

  private openBubble(itemId: string, pop = true) {
    const cur = this.current();
    const v = this.views.get(itemId);
    this.bubble?.box.destroy();
    this.bubble = undefined;
    if (!cur || !v) return;
    this.tooltip?.destroy();
    const { item, entity: e } = v;
    const edit = this.canEdit();
    const W = 132;
    const PAD = 6;
    const INK = '#1a1c2c';
    const box = this.add.container(0, 0).setDepth(150);
    const say = (y: number, str: string, size: number, color = INK) => {
      const t = this.text(-W / 2 + PAD, y, str, size, color, W - 2 * PAD).setOrigin(0, 0).setStroke('#ffffff', 0).setAlign('left');
      box.add(t);
      return y + t.displayHeight + 3;
    };

    // Content, top to bottom.
    const info = TYPE_INFO[item.type];
    const optional = item.type === 'stretch' || item.mvp === false;
    let y = say(0, item.title, 5);
    y = say(y, `${info.label.toUpperCase()} · ${STATUS_LABEL[item.status].toUpperCase()}${optional ? ' · OPTIONAL' : ''}`, 3.5, '#5a6988');
    if (item.notes) y = say(y, item.notes.length > 160 ? `${item.notes.slice(0, 157)}...` : item.notes, 4);
    if (item.dependsOn?.length) {
      const names = item.dependsOn.map((id) => cur.level.items.find((i) => i.id === id)?.title ?? id);
      y = say(y, `After: ${names.join(', ')}`, 3.5, '#5a6988');
    }
    if (item.levelRef) y = say(y, `Needs level ${item.levelRef}`, 3.5, '#5a6988');

    // Buttons.
    const buttons: [string, number, () => void][] = [];
    if (edit) {
      if (item.status === 'done' || item.status === 'dropped')
        buttons.push([item.status === 'done' ? 'REOPEN' : 'RESTORE', 0x8b9bb4, () => this.setStatus(item.id, 'todo')]);
      else {
        buttons.push(['DONE!', 0x63c74d, () => this.setStatus(item.id, 'done')]);
        if (item.status === 'todo') buttons.push(['START', 0xfeae34, () => this.setStatus(item.id, 'doing')]);
      }
      buttons.push([
        'EDIT',
        0xc0cbdc,
        () => {
          this.closeBubble();
          itemForm(this.app, cur.world.id, cur.level, item);
        },
      ]);
    }
    buttons.push(['X', 0xe4a672, () => this.closeBubble()]);
    let bx = -W / 2 + PAD;
    let by = y + 1;
    let bh = 0;
    for (const [label, color, run] of buttons) {
      const t = this.text(0, 0, label, 4.5, INK).setStroke('#ffffff', 0).setOrigin(0.5);
      const bw = t.displayWidth + 8;
      bh = t.displayHeight + 6;
      // Wrap to a new row rather than overflow the bubble.
      if (bx > -W / 2 + PAD && bx + bw > W / 2 - PAD) {
        bx = -W / 2 + PAD;
        by += bh + 4;
      }
      const rect = this.add.rectangle(bx, by, bw, bh, color).setOrigin(0).setStrokeStyle(1, 0x1a1c2c);
      t.setPosition(bx + bw / 2, by + bh / 2);
      this.clickable(rect, run);
      rect.on('pointerover', () => rect.setFillStyle(Phaser.Display.Color.IntegerToColor(color).brighten(15).color));
      rect.on('pointerout', () => rect.setFillStyle(color));
      box.add([rect, t]);
      bx += bw + 4;
    }
    const H = by + bh + PAD;

    // Place above the item (tail pointing down), or below it near the top.
    const cam = this.cameras.main;
    const view = cam.worldView;
    const cx = e.x * TILE + (e.w * TILE) / 2;
    const top = GROUND_Y - (e.y + e.h) * TILE - (e.kind === 'pipe' && item.status !== 'done' ? TILE : 0);
    const bottom = GROUND_Y - e.y * TILE;
    const TAIL = 8;
    const above = top - TAIL - H - PAD > view.y + 2;
    const boxX = Phaser.Math.Clamp(cx, view.x + W / 2 + 3, view.x + view.width - W / 2 - 3);
    const boxY = above ? top - TAIL - H + PAD : bottom + TAIL + PAD;
    box.setPosition(boxX, boxY);

    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1).lineStyle(1.5, 0x1a1c2c, 1);
    g.fillRoundedRect(-W / 2, -PAD, W, H, 5).strokeRoundedRect(-W / 2, -PAD, W, H, 5);
    const tx = Phaser.Math.Clamp(cx - boxX, -W / 2 + 10, W / 2 - 10);
    const edge = above ? H - PAD : -PAD;
    const tip = above ? edge + TAIL : edge - TAIL;
    g.fillTriangle(tx - 5, edge, tx + 5, edge, tx, tip);
    g.lineBetween(tx - 5, edge, tx, tip).lineBetween(tx + 5, edge, tx, tip);
    g.lineStyle(2, 0xffffff, 1).lineBetween(tx - 4, edge, tx + 4, edge);
    // Swallow clicks on the bubble itself so they don't close it.
    const hit = this.add.zone(-W / 2, -PAD, W, H).setOrigin(0).setInteractive();
    box.addAt(g, 0);
    box.addAt(hit, 1);

    if (pop) {
      box.setScale(0.6).setAlpha(0);
      this.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 120, ease: 'Back.out' });
    }
    this.bubble = { itemId, box, status: item.status };
  }

  // ---- Animation ----

  private idle() {
    this.hero.anims.stop();
    this.hero.setTexture('hero');
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
      this.hero.play('hero-walk');
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
      this.hero.setTexture('hero-jump');
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
        else if (e.kind === 'pipe') this.poof(cx, topY - 8);
        else if (e.kind === 'checkpoint' && v.flag) {
          const y = v.flag.y;
          v.flag.y = (e.h - 1) * TILE - 4;
          this.tweens.add({ targets: v.flag, y, duration: 500, ease: 'Quad.out' });
        } else if (e.kind === 'sign' && v.top) this.tweens.add({ targets: v.top, scaleX: 0, yoyo: true, duration: 120 });
        else if (e.kind === 'coins') for (let i = 0; i < 3; i++) this.popCoin(e.x * TILE + i * TILE + 8, topY, i * 80);
      } else if (item.status === 'dropped') this.poof(cx, topY + (e.h * TILE) / 2);
    }

    if (cleared && !this.wasCleared) await this.celebrate(level);
    else if (!cleared && this.wasCleared) {
      this.hero.setVisible(true);
      this.hero.x = this.layout.castleX * TILE;
    }
    this.wasCleared = cleared;
    if (!cleared) await this.walkTo(this.layout.hero.x * TILE);
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
