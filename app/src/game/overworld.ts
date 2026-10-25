import Phaser from 'phaser';
import { isWorldCleared, isWorldLocked, layoutWorldMap, orderedWorlds, suggestNext, worldTotals, type MapLayout } from '@quest/shared';
import { play as sfx } from '../audio';
import { fanfareStore } from '../config';
import { go } from '../router';
import { TILE, type ThemeKey } from '../sprites/render';
import { islandTexture, QuestScene, reducedMotion } from './common';
import { dueFanfares, fanfareKey, lockReason, routeBetween } from './map-life';

const COL = 8 * TILE;
const ROW = 128;
/** Room above/below the islands for labels. */
const PAD_Y = 64;

interface Island {
  key: string;
  theme: ThemeKey;
  locked: boolean;
  cleared: boolean;
  label: string;
  name: string;
  stats?: string;
  /** The suggested next world: it twinkles. */
  here?: boolean;
  /** Why a locked world is locked, for its padlock's tooltip. */
  why?: string;
  onClick: () => void;
}

interface IslandMap {
  islands: Island[];
  layout: MapLayout;
  /** The island the hero stands on. */
  heroAt?: string;
  /** Islands owed a world-clear fanfare, and the key it's remembered by. */
  fanfares?: { key: string; seen: string }[];
}

/**
 * Sea of islands. Islands sit in columns by dependency depth and dotted paths
 * run from each world to every world that unlocks after it, so one world can
 * open onto many.
 */
abstract class IslandScene extends QuestScene {
  private layer?: Phaser.GameObjects.Container;
  private sig = '';
  /** Each island, by key: where tests click. */
  private spots = new Map<string, Phaser.GameObjects.Image>();
  private walking = false;

  init() {
    super.init();
    this.layer = undefined;
    this.sig = '';
    this.spots = new Map();
    this.walking = false;
  }

  create() {
    // Fades in after the console boot sequence (and harmlessly otherwise).
    this.cameras.main.fadeIn(300);
    this.enableScrolling();
    this.render();
    this.watch(() => this.render());
  }

  protected onResize() {
    this.sig = '';
    this.render();
  }

  protected abstract map(): IslandMap | undefined;

  private render() {
    const data = this.map();
    if (!data) return;
    const { islands, layout } = data;
    const sig = JSON.stringify([islands.map(({ onClick: _, ...i }) => i), layout, data.heroAt, this.scale.width, this.scale.height]);
    if (sig === this.sig) return;
    this.sig = sig;

    // Content box: columns left to right, each column centred on y = 0.
    const cols = Math.max(1, layout.cols);
    const rows = Math.max(1, layout.rows);
    const contentW = (cols - 1) * COL + 2 * COL;
    const contentH = (rows - 1) * ROW + 2 * PAD_Y;
    const cam = this.cameras.main;
    const byH = this.scale.height / contentH;
    const byW = this.scale.width / Math.min(contentW, 4 * COL + COL);
    cam.setZoom(Math.max(0.5, Math.min(byH, byW, 3)));
    const viewW = this.scale.width / cam.zoom;
    const viewH = this.scale.height / cam.zoom;
    const boundsW = Math.max(contentW, viewW);
    const boundsH = Math.max(contentH, viewH);
    const left = contentW < viewW ? -(viewW - contentW) / 2 : 0;
    cam.setBounds(left, -boundsH / 2, boundsW, boundsH);
    cam.setBackgroundColor('#2a6ec1');

    this.layer?.destroy();
    const layer = (this.layer = this.add.container(0, 0));
    this.spots = new Map();

    // Sea with drifting wave marks.
    const waves = this.add.graphics();
    waves.fillStyle(0x5c94fc, 1);
    const rand = new Phaser.Math.RandomDataGenerator(['sea']);
    for (let i = 0; i < (boundsW * boundsH) / 900; i++)
      waves.fillRect(left + rand.between(0, boundsW), rand.between(-boundsH / 2, boundsH / 2), rand.between(4, 10), 2);
    layer.add(waves);
    this.tweens.add({ targets: waves, x: 6, yoyo: true, repeat: -1, duration: 2200, ease: 'Sine.inOut' });

    const perCol = new Map<number, number>();
    for (const n of layout.nodes) perCol.set(n.col, (perCol.get(n.col) ?? 0) + 1);
    const at = new Map(
      layout.nodes.map((n) => [n.id, { x: COL + n.col * COL, y: (n.row - (perCol.get(n.col)! - 1) / 2) * ROW }]),
    );
    const byKey = new Map(islands.map((i) => [i.key, i]));

    // Paths: gold once the dependency is cleared, faded while it's still locked.
    const path = this.add.graphics();
    const curves = new Map<string, Phaser.Curves.CubicBezier>();
    for (const e of layout.edges) {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      const from = new Phaser.Math.Vector2(a.x + 40, a.y + 4);
      const to = new Phaser.Math.Vector2(b.x - 40, b.y + 4);
      const curve = new Phaser.Curves.CubicBezier(
        from,
        new Phaser.Math.Vector2(from.x + (to.x - from.x) / 2, from.y),
        new Phaser.Math.Vector2(from.x + (to.x - from.x) / 2, to.y),
        to,
      );
      curves.set(`${e.from}>${e.to}`, curve);
      const open = byKey.get(e.from)?.cleared;
      path.fillStyle(open ? 0xfee761 : 0xead4aa, open ? 1 : 0.55);
      const dots = Math.max(2, Math.floor(curve.getLength() / 7));
      for (const p of curve.getSpacedPoints(dots).slice(1, -1)) path.fillRect(p.x - 1, p.y - 1, 3, 3);
      // Arrowhead into the dependent world.
      path.fillTriangle(to.x + 2, to.y, to.x - 5, to.y - 4, to.x - 5, to.y + 4);
    }
    layer.add(path);

    if (!islands.length) layer.add(this.text(left + boundsW / 2, 0, this.emptyText(), 6, '#ffffff', 200).setOrigin(0.5));

    // The hero waits beside an island, and walks the paths between them (#23).
    const stand = (key: string) => ({ x: at.get(key)!.x + 18, y: at.get(key)!.y - 4 });
    let hero: Phaser.GameObjects.Sprite | undefined;
    let heroAt = data.heroAt && at.has(data.heroAt) ? data.heroAt : undefined;
    const bob = () => {
      const { y } = stand(heroAt!);
      hero!.setY(y);
      this.tweens.add({ targets: hero, y: y - 4, yoyo: true, repeat: -1, duration: 400 });
    };
    const walkTo = async (key: string) => {
      if (!hero || !heroAt || heroAt === key) return;
      const route = routeBetween(layout, heroAt, key);
      if (!route) {
        // No path joins them: blink out and pop up there.
        this.tweens.killTweensOf(hero);
        sfx('dash');
        await this.tween({ targets: hero, alpha: 0, duration: 120 });
        hero.setPosition(stand(key).x, stand(key).y);
        await this.tween({ targets: hero, alpha: 1, duration: 120 });
      } else {
        const points = [{ x: hero.x, y: stand(heroAt).y }];
        for (const h of route) {
          const c = h.forward ? curves.get(`${h.from}>${h.to}`) : curves.get(`${h.to}>${h.from}`);
          const along = c ? c.getSpacedPoints(Math.max(4, Math.floor(c.getLength() / 12))) : [];
          points.push(...(h.forward ? along : along.reverse()).map((p) => ({ x: p.x, y: p.y })), stand(h.to));
        }
        await this.walkAlong(hero, points);
      }
      heroAt = key;
    };
    const enter = async (isl: Island) => {
      if (this.walking) return;
      if (reducedMotion()) return isl.onClick();
      this.walking = true;
      await walkTo(isl.key);
      await this.wait(80);
      this.walking = false;
      isl.onClick();
    };

    let focus = at.get(islands[0]?.key ?? '') ?? { x: 0, y: 0 };
    const tips: Phaser.GameObjects.Text[] = [];
    for (const isl of islands) {
      const { x, y } = at.get(isl.key)!;
      const img = this.add.image(x, y, islandTexture(this, isl.theme, isl.locked));
      this.spots.set(isl.key, img);
      layer.add(img);
      // A locked world says why on the map: its padlock shakes and a tooltip names what unlocks it.
      const lock = isl.locked ? this.add.image(x - 22, y - 12, 'padlock') : undefined;
      const tip = isl.why ? this.text(x, y - 50, `Locked: ${isl.why}`, 4, '#ffffff', 120).setOrigin(0.5, 1).setVisible(false) : undefined;
      let tipTimer: Phaser.Time.TimerEvent | undefined;
      let armed = false;
      this.clickable(img, () => {
        sfx('select');
        if (!lock) return void enter(isl);
        // First click explains; a second while the tooltip's up peeks inside anyway.
        if (armed) return isl.onClick();
        sfx('buzz');
        armed = true;
        tip?.setVisible(true);
        tipTimer?.remove();
        tipTimer = this.time.delayedCall(2500, () => {
          armed = false;
          tip?.setVisible(false);
        });
        if (!reducedMotion()) {
          this.tweens.killTweensOf(lock);
          lock.setAngle(0);
          void this.tween({ targets: lock, angle: { from: -18, to: 18 }, yoyo: true, repeat: 2, duration: 60 }).then(() => lock.setAngle(0));
        }
      });
      img.on('pointerover', () => {
        img.setScale(1.08);
        tip?.setVisible(true);
      });
      img.on('pointerout', () => {
        img.setScale(1);
        if (!armed) tip?.setVisible(false);
      });
      layer.add(this.text(x, y - 38, isl.label, 4, '#fee761').setOrigin(0.5, 1));
      const name = this.text(x, y + 26, isl.name, 5, '#ffffff', 100).setOrigin(0.5, 0);
      layer.add(name);
      if (isl.stats) {
        // Below the (possibly wrapped) name.
        const sy = name.y + name.displayHeight + 3;
        const stats = this.text(x + 5, sy, isl.stats, 4, '#ffffff').setOrigin(0.5, 0);
        layer.add(stats);
        layer.add(this.add.image(stats.x - stats.displayWidth / 2 - 6, sy + stats.displayHeight / 2, 'star').setScale(0.5));
      }
      if (lock) layer.add(lock);
      if (tip) tips.push(tip);
      if (isl.here) layer.add(this.twinkle(x - 26, y + 6));
      if (isl.key === heroAt) focus = { x, y };
    }
    if (heroAt) {
      const { x, y } = stand(heroAt);
      hero = this.add.sprite(x, y, this.heroTex()).setOrigin(0.5, 1);
      layer.add(hero);
      bob();
    }
    // Tooltips over everything else.
    layer.add(tips);
    cam.centerOn(focus.x, 0);

    for (const f of data.fanfares ?? []) {
      const isl = byKey.get(f.key);
      const p = at.get(f.key);
      if (isl && p) void this.fanfare(f.seen, p.x, p.y, isl.name);
    }
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

  protected map(): IslandMap | undefined {
    const state = this.app.state;
    const pid = this.app.projectId;
    if (!state || !pid) return;
    const next = suggestNext(state);
    const worlds = orderedWorlds(state);
    const islands = worlds.map((w, i) => {
      const t = worldTotals(w);
      const why = lockReason(state, w);
      return {
        key: w.id,
        theme: w.theme,
        locked: !!why,
        why,
        cleared: isWorldCleared(w),
        label: `WORLD ${i + 1}`,
        name: w.name,
        stats: `${t.stars}/${t.maxStars}  LV ${t.cleared}/${t.levels}`,
        here: next?.worldId === w.id,
        onClick: () => go({ view: 'world', projectId: pid, worldId: w.id }),
      };
    });
    // The hero waits at the suggested world, else the first open one left to clear, else the last.
    const heroAt = next?.worldId ?? worlds.find((w) => !isWorldCleared(w) && !isWorldLocked(state, w))?.id ?? worlds.at(-1)?.id;
    const fanfares = dueFanfares(pid, worlds, fanfareStore.get()).map((id) => ({ key: id, seen: fanfareKey(pid, id) }));
    return { islands, layout: layoutWorldMap(state), heroAt, fanfares };
  }

  protected emptyText() {
    return this.app.caps.canEdit ? 'No worlds yet: add one in the panel' : 'No worlds yet';
  }
}
