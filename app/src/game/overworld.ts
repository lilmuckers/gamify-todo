import Phaser from 'phaser';
import { isWorldLocked, orderedWorlds, suggestNext, worldTotals } from '@quest/shared';
import { go } from '../router';
import { TILE } from '../sprites/render';
import { islandTexture, QuestScene, WORLD_H } from './common';

const SPACING = 8 * TILE;

/** Sea of islands, one per world, joined by a path. */
export class OverworldScene extends QuestScene {
  private layer?: Phaser.GameObjects.Container;
  private sig = '';

  constructor() {
    super('overworld');
  }

  init() {
    super.init();
    this.layer = undefined;
    this.sig = '';
  }

  create() {
    this.enableScrolling();
    this.render();
    this.watch(() => this.render());
  }

  protected onResize() {
    super.onResize();
    this.sig = '';
    this.render();
  }

  private render() {
    const state = this.app.state;
    if (!state) return;
    const worlds = orderedWorlds(state);
    const next = suggestNext(state);
    const warp = this.app.caps.canReviewPRs;
    const prCount = this.app.pulls.list?.length;
    const sig = JSON.stringify([worlds.map((w) => [w.id, w.name, w.theme, worldTotals(w), isWorldLocked(state, w)]), next, warp, prCount]);
    if (sig === this.sig) return;
    this.sig = sig;

    const count = worlds.length + (warp ? 1 : 0);
    const width = count * SPACING + 6 * TILE;
    this.setupCamera(width, Math.min(width, 4 * SPACING + 2 * TILE));
    const startX = Math.max(4 * TILE, (this.viewWidth - (count - 1) * SPACING) / 2);
    this.layer?.destroy();
    const layer = (this.layer = this.add.container(0, 0));
    const W = Math.max(width, this.viewWidth) + 2 * TILE;

    // Sea with drifting wave marks.
    this.cameras.main.setBackgroundColor('#2a6ec1');
    const pad = WORLD_H;
    const waves = this.add.graphics();
    waves.fillStyle(0x5c94fc, 1);
    const rand = new Phaser.Math.RandomDataGenerator(['sea']);
    for (let i = 0; i < W / 5; i++) waves.fillRect(rand.between(0, W), rand.between(-pad, WORLD_H + pad), rand.between(4, 10), 2);
    layer.add(waves);
    this.tweens.add({ targets: waves, x: 6, yoyo: true, repeat: -1, duration: 2200, ease: 'Sine.inOut' });

    const pos = Array.from({ length: count }, (_, i) => ({ x: startX + i * SPACING, y: i % 2 ? 90 : 150 }));
    const path = this.add.graphics();
    path.fillStyle(0xead4aa, 1);
    for (let i = 0; i < pos.length - 1; i++) {
      const a = pos[i];
      const b = pos[i + 1];
      const steps = Math.floor(Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) / 7);
      for (let s = 2; s < steps - 1; s++) path.fillRect(a.x + ((b.x - a.x) * s) / steps - 1, a.y + ((b.y - a.y) * s) / steps - 1, 3, 3);
    }
    layer.add(path);

    let focusX = pos[0]?.x ?? 0;
    worlds.forEach((w, i) => {
      const { x, y } = pos[i];
      const locked = isWorldLocked(state, w);
      const img = this.add.image(x, y, islandTexture(this, w.theme, locked));
      this.clickable(img, () => go({ view: 'world', worldId: w.id }));
      img.on('pointerover', () => img.setScale(1.08));
      img.on('pointerout', () => img.setScale(1));
      layer.add(img);
      const t = worldTotals(w);
      layer.add(this.text(x, y - 38, `WORLD ${i + 1}`, 4, '#fee761').setOrigin(0.5, 1));
      layer.add(this.text(x, y + 26, w.name, 5, '#ffffff', 90).setOrigin(0.5, 0));
      layer.add(this.add.image(x - 22, y + 43, 'star').setScale(0.5));
      layer.add(this.text(x - 14, y + 40, `${t.stars}/${t.maxStars}  LV ${t.cleared}/${t.levels}`, 4, '#ffffff').setOrigin(0, 0));
      if (next?.worldId === w.id || (!next && i === 0)) focusX = x;
      if (next?.worldId === w.id) {
        const hero = this.add.image(x + 18, y - 4, 'hero').setOrigin(0.5, 1);
        layer.add(hero);
        this.tweens.add({ targets: hero, y: y - 8, yoyo: true, repeat: -1, duration: 400 });
      }
    });

    if (warp) {
      const { x, y } = pos[count - 1];
      const img = this.add.image(x, y, islandTexture(this, 'warp', false));
      this.clickable(img, () => go({ view: 'prs' }));
      layer.add(img);
      layer.add(this.text(x, y - 38, 'WARP ZONE', 4, '#f6757a').setOrigin(0.5, 1));
      layer.add(this.text(x, y + 26, prCount === undefined ? 'Review PRs' : `${prCount} PR${prCount === 1 ? '' : 's'} to review`, 5, '#ffffff', 90).setOrigin(0.5, 0));
      void this.app.loadPulls();
    }
    this.cameras.main.centerOnX(focusX);
  }
}
