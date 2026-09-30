import Phaser from 'phaser';
import { isWorldLocked, orderedWorlds, suggestNext, worldTotals } from '@quest/shared';
import { go } from '../router';
import { TILE, type ThemeKey } from '../sprites/render';
import { islandTexture, QuestScene, WORLD_H } from './common';

const SPACING = 8 * TILE;

interface Island {
  key: string;
  theme: ThemeKey;
  locked: boolean;
  label: string;
  labelColor?: string;
  name: string;
  stats?: string;
  here?: boolean;
  onClick: () => void;
}

/** Sea of islands joined by a path. Subclasses decide what the islands are. */
abstract class IslandScene extends QuestScene {
  private layer?: Phaser.GameObjects.Container;
  private sig = '';

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

  protected abstract islands(): Island[] | undefined;

  private render() {
    const islands = this.islands();
    if (!islands) return;
    const sig = JSON.stringify(islands.map(({ onClick: _, ...i }) => i));
    if (sig === this.sig) return;
    this.sig = sig;

    const count = Math.max(1, islands.length);
    const width = count * SPACING + 6 * TILE;
    this.setupCamera(width, Math.min(width, 4 * SPACING + 2 * TILE));
    const startX = Math.max(4 * TILE, (this.viewWidth - (count - 1) * SPACING) / 2);
    this.layer?.destroy();
    const layer = (this.layer = this.add.container(0, 0));
    const W = Math.max(width, this.viewWidth) + 2 * TILE;

    // Sea with drifting wave marks.
    this.cameras.main.setBackgroundColor('#2a6ec1');
    const waves = this.add.graphics();
    waves.fillStyle(0x5c94fc, 1);
    const rand = new Phaser.Math.RandomDataGenerator(['sea']);
    for (let i = 0; i < W / 5; i++) waves.fillRect(rand.between(0, W), rand.between(-WORLD_H, 2 * WORLD_H), rand.between(4, 10), 2);
    layer.add(waves);
    this.tweens.add({ targets: waves, x: 6, yoyo: true, repeat: -1, duration: 2200, ease: 'Sine.inOut' });

    const pos = islands.map((_, i) => ({ x: startX + i * SPACING, y: i % 2 ? 90 : 150 }));
    const path = this.add.graphics();
    path.fillStyle(0xead4aa, 1);
    for (let i = 0; i < pos.length - 1; i++) {
      const a = pos[i];
      const b = pos[i + 1];
      const steps = Math.floor(Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) / 7);
      for (let s = 2; s < steps - 1; s++) path.fillRect(a.x + ((b.x - a.x) * s) / steps - 1, a.y + ((b.y - a.y) * s) / steps - 1, 3, 3);
    }
    layer.add(path);

    if (!islands.length) layer.add(this.text(this.viewWidth / 2, WORLD_H / 2, this.emptyText(), 6, '#ffffff', 200).setOrigin(0.5));

    let focusX = pos[0]?.x ?? 0;
    islands.forEach((isl, i) => {
      const { x, y } = pos[i];
      const img = this.add.image(x, y, islandTexture(this, isl.theme, isl.locked));
      this.clickable(img, isl.onClick);
      img.on('pointerover', () => img.setScale(1.08));
      img.on('pointerout', () => img.setScale(1));
      layer.add(img);
      layer.add(this.text(x, y - 38, isl.label, 4, isl.labelColor ?? '#fee761').setOrigin(0.5, 1));
      layer.add(this.text(x, y + 26, isl.name, 5, '#ffffff', 100).setOrigin(0.5, 0));
      if (isl.stats) {
        layer.add(this.add.image(x - 22, y + 45, 'star').setScale(0.5));
        layer.add(this.text(x - 14, y + 42, isl.stats, 4, '#ffffff').setOrigin(0, 0));
      }
      if (isl.here) {
        focusX = x;
        const hero = this.add.image(x + 18, y - 4, 'hero').setOrigin(0.5, 1);
        layer.add(hero);
        this.tweens.add({ targets: hero, y: y - 8, yoyo: true, repeat: -1, duration: 400 });
      }
    });
    this.cameras.main.centerOnX(focusX);
  }

  protected emptyText() {
    return 'Nothing here yet';
  }
}

/** One project's map: an island per world. */
export class OverworldScene extends IslandScene {
  constructor() {
    super('overworld');
  }

  protected islands(): Island[] | undefined {
    const state = this.app.state;
    const pid = this.app.projectId;
    if (!state || !pid) return;
    const next = suggestNext(state);
    return orderedWorlds(state).map((w, i) => {
      const t = worldTotals(w);
      return {
        key: w.id,
        theme: w.theme,
        locked: isWorldLocked(state, w),
        label: `WORLD ${i + 1}`,
        name: w.name,
        stats: `${t.stars}/${t.maxStars}  LV ${t.cleared}/${t.levels}`,
        here: next?.worldId === w.id,
        onClick: () => go({ view: 'world', projectId: pid, worldId: w.id }),
      };
    });
  }

  protected emptyText() {
    return this.app.caps.canEdit ? 'No worlds yet: add one in the panel' : 'No worlds yet';
  }
}
