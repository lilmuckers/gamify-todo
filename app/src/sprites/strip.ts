import { layoutLevel, scoreLevel, type Level, type LevelDiff } from '@quest/shared';
import { THEMES } from './pixels';
import { sprite, TILE, type ThemeKey } from './render';

const GROUND = 12 * TILE;
const H = 15 * TILE;

export interface Strip {
  canvas: HTMLCanvasElement;
  heroX: number;
  /** Item id at a canvas-space x/y, for tap handling. */
  hit(x: number, y: number): string | undefined;
}

/** Static 2D-canvas render of a level for the mobile view (no Phaser needed). */
export function drawStrip(level: Level, theme: ThemeKey, diff?: LevelDiff, selected?: string, sub = false, hero = 'hero'): Strip {
  const L = layoutLevel(level, { sub });
  const width = L.width * TILE;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const t = THEMES[theme];
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, t.sky);
  grad.addColorStop(1, t.skyLow);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, H);

  const draw = (name: string, x: number, y: number, alpha = 1, scale = 1) => {
    const s = sprite(name, theme);
    ctx.globalAlpha = alpha;
    ctx.drawImage(s, Math.round(x), Math.round(y), s.width * scale, s.height * scale);
    ctx.globalAlpha = 1;
  };
  for (const d of L.decorations) {
    if (d.kind === 'cloud' && !sub) draw('cloud', d.x * TILE, (13 - d.y) * TILE - 8, 0.95, 0.5 + d.size * 0.25);
    if (d.kind === 'hill') {
      const s = 0.6 + d.size * 0.3;
      draw('hill', d.x * TILE, GROUND - 40 * s, 1, s);
    }
    if (d.kind === 'bush') {
      const s = 0.4 + d.size * 0.2;
      draw('bush', d.x * TILE, GROUND - 16 * s, 1, s);
    }
  }
  for (let x = 0; x < width; x += TILE) {
    draw('ground-top', x, GROUND);
    draw('ground-fill', x, GROUND + TILE);
    draw('ground-fill', x, GROUND + 2 * TILE);
  }
  const cleared = scoreLevel(level).cleared;
  const fx = L.flagX * TILE;
  if (sub) {
    // Underground: brick ceiling, entry pipe from above, exit pipe up.
    for (let x = 0; x < width; x += TILE) draw('brick', x, 0);
    draw('pipe-body', TILE, TILE);
    draw('pipe-body', TILE, 2 * TILE);
    draw('pipe-top', TILE, 3 * TILE);
    draw('pipe-top', fx, GROUND - 2 * TILE);
    draw('pipe-body', fx, GROUND - TILE);
    if (cleared) draw('arrow-up', fx + 8, GROUND - 3 * TILE - 4);
  } else {
    draw('used', fx, GROUND - TILE);
    for (let i = 1; i < 9; i++) draw('pole', fx, GROUND - TILE - i * TILE);
    draw('pole-top', fx, GROUND - 10 * TILE);
    draw(cleared ? 'flag' : 'flag-grey', fx - 10, cleared ? GROUND - 3 * TILE : GROUND - 9 * TILE);
    draw('castle', L.castleX * TILE, GROUND - 80);
  }

  const byId = new Map(level.items.map((i) => [i.id, i]));
  for (const e of L.entities) {
    const item = byId.get(e.itemId)!;
    const x = e.x * TILE;
    const top = GROUND - (e.y + e.h) * TILE;
    const done = item.status === 'done';
    const a = item.status === 'dropped' ? 0.3 : 1;
    switch (e.kind) {
      case 'qblock':
        draw(done ? 'used' : 'qblock', x, top, a);
        break;
      case 'checkpoint':
        draw('pole-top', x, top, a);
        for (let i = 1; i < e.h; i++) draw('pole', x, top + i * TILE, a);
        draw(done ? 'flag' : 'flag-grey', x + 8, done ? top + 4 : top + (e.h - 1) * TILE - 4, a);
        break;
      case 'wall':
        if (done) draw('rubble', x, top + (e.h - 1) * TILE);
        else for (let i = 0; i < e.h; i++) draw('brick', x, top + i * TILE, a);
        break;
      case 'pipe':
        if (!done && item.status !== 'dropped') draw('plant', x + 8, top - TILE + 6);
        draw('pipe-top', x, top, a);
        for (let i = 1; i < e.h; i++) draw('pipe-body', x, top + i * TILE, a);
        break;
      case 'warp':
        if (!done && item.status !== 'dropped') draw('arrow-down', x + 8, top - TILE);
        draw('pipe-top', x, top, a);
        for (let i = 1; i < e.h; i++) draw('pipe-body', x, top + i * TILE, a);
        break;
      case 'cloud':
        draw('cloud-ride', x, top - 4, done ? 0.6 : a, 1.5);
        break;
      case 'critter':
        draw(done ? 'critter-flat' : 'critter', x, top, a);
        break;
      case 'sign':
        draw(done ? 'sign-ok' : 'sign-q', x, top, a);
        draw('post', x, top + TILE, a);
        break;
      case 'coins':
        for (let i = 0; i < 3; i++) draw(done ? 'coin-ghost' : 'coin', x + i * TILE, top, a);
        break;
    }
    if (item.status === 'doing') draw('sparkle', x + e.w * TILE - 4, top - 6);
    const change = diff?.items[item.id]?.change;
    const outline = change ? { added: '#63c74d', modified: '#feae34', removed: '#e43b44' }[change] : selected === item.id ? '#fee761' : undefined;
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1.5, top - 1.5, e.w * TILE + 3, e.h * TILE + 3);
    }
  }
  const heroX = L.hero.x * TILE;
  if (!cleared || sub) draw(hero, heroX, GROUND - TILE);

  return {
    canvas: c,
    heroX,
    hit(px, py) {
      const e = L.entities.find(
        (e) => px >= e.x * TILE - 4 && px <= (e.x + e.w) * TILE + 4 && py >= GROUND - (e.y + e.h + 1) * TILE && py <= GROUND + 4,
      );
      return e?.itemId;
    },
  };
}
