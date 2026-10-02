import Phaser from 'phaser';
import { levelNodeState, scoreLevel, suggestNext, type Level, type LevelDiff, type World } from '@quest/shared';
import { pullLookup } from '../data/source';
import { go } from '../router';
import { DIFF_COLOR, NODE_SPRITE, THEMES } from '../sprites/pixels';
import { TILE, type ThemeKey } from '../sprites/render';
import { GROUND_Y, QuestScene, tex } from './common';

export interface WorldParams {
  projectId?: string;
  worldId?: string;
  pr?: number;
  /** The Warp Zone: one pipe per open PR. */
  prs?: boolean;
}

interface Node {
  key: string;
  name: string;
  sprite: string;
  stars?: number;
  change?: LevelDiff['change'];
  onClick: () => void;
  here?: boolean;
}

const NODE_SPACING = 5 * TILE;

/** SMB3-style path of level nodes. Also renders a PR as a "Warp World". */
export class WorldScene extends QuestScene {
  private params!: WorldParams;
  private layer?: Phaser.GameObjects.Container;
  private skyGfx?: Phaser.GameObjects.Graphics;
  private sig = '';

  constructor() {
    super('world');
  }

  init(params: WorldParams) {
    super.init();
    this.params = params;
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

  private nodes(): { theme: ThemeKey; nodes: Node[]; empty?: string } | undefined {
    const p = this.params;
    if (p.prs) {
      const pulls = this.app.pulls;
      if (!this.app.caps.canReviewPRs) return { theme: 'warp', nodes: [], empty: 'Connect GitHub in Settings to review PRs' };
      if (pulls.error) return { theme: 'warp', nodes: [], empty: "Couldn't load PRs" };
      if (!pulls.list) return { theme: 'warp', nodes: [], empty: 'Scanning pipes...' };
      return {
        theme: 'warp',
        empty: 'No open PRs change quest data. All quiet!',
        nodes: pulls.list.map((pr) => ({
          key: `pr-${pr.number}`,
          name: `#${pr.number} ${pr.title}`,
          sprite: 'warp-pipe',
          onClick: () => go({ view: 'pr', pr: pr.number }),
        })),
      };
    }
    if (p.pr) {
      const v = this.app.pullView(p.pr);
      if (v?.error) return { theme: 'warp', nodes: [], empty: "Couldn't load this PR" };
      if (!v?.diff || !v.data) return { theme: 'warp', nodes: [], empty: 'Loading warp world...' };
      const find = pullLookup(v.data);
      return {
        theme: 'warp',
        empty: 'This PR changes no levels',
        nodes: v.diff.levels.map((d) => {
          const l = find.level(d) as Level;
          return {
            key: `${d.projectId}/${d.worldId}/${d.levelId}`,
            name: l.name,
            sprite: d.change === 'removed' ? 'node-lock' : d.change === 'added' ? 'node-clear' : 'node-active',
            change: d.change,
            onClick: () => go({ view: 'pr-level', pr: p.pr!, projectId: d.projectId, worldId: d.worldId, levelId: d.levelId }),
          };
        }),
      };
    }
    const state = this.app.state;
    const w: World | undefined = state?.worlds[p.worldId!];
    if (!state || !w) return;
    const next = suggestNext(state);
    const active = w.levels.find((l) => l.startedAt && !scoreLevel(l).cleared)?.id ?? (next?.worldId === w.id ? next.levelId : undefined);
    return {
      theme: w.theme,
      nodes: w.levels.map((l, i) => {
        const sc = scoreLevel(l);
        return {
          key: l.id,
          name: l.name,
          sprite: NODE_SPRITE[levelNodeState(w, i)],
          stars: sc.cleared ? sc.stars : undefined,
          here: l.id === active,
          onClick: () => go({ view: 'level', projectId: p.projectId!, worldId: w.id, levelId: l.id }),
        };
      }),
    };
  }

  private render() {
    const data = this.nodes();
    if (!data) return;
    const sig = JSON.stringify([data.empty, data.nodes.map((n) => [n.key, n.name, n.sprite, n.stars, n.change, n.here])]);
    if (sig === this.sig) return;
    this.sig = sig;
    const { theme, nodes } = data;
    const colors = THEMES[theme];
    const width = Math.max(nodes.length * NODE_SPACING + 12 * TILE, 0);
    this.setupCamera(width, Math.min(width, 5 * NODE_SPACING + 4 * TILE));
    const startX = Math.max(3 * TILE, (this.viewWidth - (nodes.length - 1) * NODE_SPACING - 6 * TILE) / 2);
    this.skyGfx?.destroy();
    this.skyGfx = this.sky(colors.sky, colors.skyLow);
    this.layer?.destroy();
    const layer = (this.layer = this.add.container(0, 0));
    const W = Math.max(width, this.viewWidth + TILE);

    layer.add(this.add.tileSprite(0, GROUND_Y, W, TILE, tex('ground-top', theme)).setOrigin(0, 0));
    layer.add(this.add.tileSprite(0, GROUND_Y + TILE, W, this.floor - GROUND_Y - TILE, tex('ground-fill', theme)).setOrigin(0, 0));
    for (let x = TILE; x < W; x += 7 * TILE) layer.add(this.add.image(x, GROUND_Y, tex('hill', theme)).setOrigin(0, 1).setScale(0.8).setAlpha(0.5));

    const pos = nodes.map((_, i) => ({ x: startX + i * NODE_SPACING, y: i % 2 ? 110 : 140 }));
    const endX = startX + nodes.length * NODE_SPACING;
    const path = this.add.graphics();
    path.fillStyle(0xfee761, 1);
    const all = [...pos, { x: endX, y: 150 }];
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i];
      const b = all[i + 1];
      const steps = Math.floor(Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) / 6);
      for (let s = 1; s < steps; s++) path.fillRect(a.x + ((b.x - a.x) * s) / steps - 1, a.y + ((b.y - a.y) * s) / steps - 1, 3, 3);
    }
    layer.add(path);
    layer.add(this.add.image(endX, GROUND_Y, 'castle').setOrigin(0.3, 1).setScale(0.7));

    if (!nodes.length)
      layer.add(
        this.text(this.viewWidth / 2, 80, data.empty ?? 'No levels yet', 6, '#ffffff', this.viewWidth - 40).setOrigin(0.5),
      );

    nodes.forEach((n, i) => {
      const { x, y } = pos[i];
      const img = this.add.image(x, y, n.sprite).setScale(1.5);
      this.clickable(img, n.onClick);
      img.on('pointerover', () => img.setScale(1.8));
      img.on('pointerout', () => img.setScale(1.5));
      layer.add(img);
      layer.add(this.text(x, y - 18, String(i + 1), 5, '#ffffff').setOrigin(0.5, 1));
      layer.add(this.text(x, y + 14, n.name, 4, '#ffffff', 70).setOrigin(0.5, 0));
      if (n.stars !== undefined)
        for (let s = 0; s < 3; s++)
          layer.add(this.add.image(x - 10 + s * 10, y + 34, s < n.stars ? 'star' : 'star-empty').setScale(0.5));
      if (n.change) {
        layer.add(this.text(x, y + 30, n.change.toUpperCase(), 4, DIFF_COLOR[n.change]).setOrigin(0.5, 0));
      }
      if (n.here) {
        const hero = this.add.image(x, y - 12, this.heroTex()).setOrigin(0.5, 1);
        layer.add(hero);
        this.tweens.add({ targets: hero, y: y - 16, yoyo: true, repeat: -1, duration: 400 });
      }
    });
    const focus = pos[Math.max(0, nodes.findIndex((n) => n.here))];
    if (focus) this.cameras.main.centerOnX(Math.max(focus.x, this.viewWidth / 2));
  }
}
