import Phaser from 'phaser';
import type { App } from '../app';
import { SPRITES } from '../sprites/pixels';
import { HERO_IDS } from '@quest/shared';
import { heroKey, type HeroFrame } from '../sprites/heroes';
import { island, sprite, TILE, type ThemeKey } from '../sprites/render';

export const WORLD_H = 15 * TILE;
export const GROUND_Y = 12 * TILE;
export const FONT = '"Press Start 2P", monospace';
export const THEMED = new Set(['ground-top', 'ground-fill', 'hill']);
const THEME_KEYS: ThemeKey[] = ['grass', 'desert', 'water', 'ice', 'sky', 'castle', 'warp', 'under'];

/** Texture key for a sprite; themed sprites get a per-theme key. */
export function tex(name: string, theme: ThemeKey = 'grass') {
  return THEMED.has(name) ? `${name}@${theme}` : name;
}

export function registerTextures(scene: Phaser.Scene) {
  const add = (key: string, canvas: HTMLCanvasElement) => {
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
  };
  for (const name of [...Object.keys(SPRITES), 'castle']) if (!THEMED.has(name)) add(name, sprite(name));
  for (const theme of THEME_KEYS) for (const name of THEMED) add(tex(name, theme), sprite(name, theme));
  for (const id of HERO_IDS) {
    for (const frame of ['stand', 'walk', 'jump'] as const) add(heroKey(id, frame), sprite(heroKey(id, frame)));
    if (!scene.anims.exists(heroWalk(id)))
      scene.anims.create({
        key: heroWalk(id),
        frames: [{ key: heroKey(id) }, { key: heroKey(id, 'walk') }],
        frameRate: 8,
        repeat: -1,
      });
  }
}

/** Walk animation key for a hero. */
export const heroWalk = (id: string) => `walk@${id}`;

export function islandTexture(scene: Phaser.Scene, theme: ThemeKey, locked: boolean) {
  const key = `island@${theme}@${locked}`;
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, island(theme, locked));
  return key;
}

/** Base scene: zoom-to-height, drag/wheel scrolling, crisp pixel text. */
export abstract class QuestScene extends Phaser.Scene {
  protected app!: App;
  protected dragged = false;
  protected worldWidth = 0;
  /** World pixels that should fit horizontally; lowers zoom on narrow screens. */
  protected minVisible = 0;
  private unsub?: () => void;

  init(_params?: object) {
    this.app = this.registry.get('app') as App;
  }

  /** Texture of the player's chosen hero. */
  protected heroTex(frame: HeroFrame = 'stand') {
    return heroKey(this.app.heroId, frame);
  }

  get zoom() {
    return this.cameras.main.zoom;
  }

  /** Visible world width at current zoom. */
  get viewWidth() {
    return this.scale.width / this.zoom;
  }

  protected setupCamera(worldWidth: number, minVisible = this.minVisible) {
    this.worldWidth = worldWidth;
    this.minVisible = minVisible;
    const cam = this.cameras.main;
    const byHeight = this.scale.height / WORLD_H;
    const byWidth = minVisible ? this.scale.width / minVisible : byHeight;
    cam.setZoom(Math.max(1, Math.min(byHeight, byWidth)));
    // Centre the 240px-tall world vertically when the view is taller.
    const viewH = this.scale.height / cam.zoom;
    const top = Math.min(0, (WORLD_H - viewH) / 2);
    cam.setBounds(0, top, Math.max(worldWidth, this.viewWidth), Math.max(WORLD_H, viewH));
    cam.roundPixels = true;
  }

  protected enableScrolling(onUserScroll?: () => void) {
    let startX = 0;
    let startScroll = 0;
    let down = false;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      down = true;
      this.dragged = false;
      startX = p.x;
      startScroll = this.cameras.main.scrollX;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!down || !p.isDown) return;
      const dx = p.x - startX;
      if (Math.abs(dx) > 4) {
        if (!this.dragged) onUserScroll?.();
        this.dragged = true;
      }
      if (this.dragged) this.cameras.main.scrollX = startScroll - dx / this.zoom;
    });
    this.input.on('pointerup', () => {
      down = false;
      // Let click handlers on objects see `dragged` before it resets.
      this.time.delayedCall(0, () => (this.dragged = false));
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, dx: number, dy: number) => {
      onUserScroll?.();
      this.cameras.main.scrollX += (Math.abs(dx) > Math.abs(dy) ? dx : dy) / this.zoom;
    });
    const keys = this.input.keyboard;
    // Leave arrow keys alone while the user is typing in a form field.
    // Play mode steers the hero with them instead.
    const typing = () => this.app.playing || !!document.activeElement?.matches('input, textarea, select, [contenteditable]');
    keys?.on('keydown-LEFT', () => typing() || (onUserScroll?.(), (this.cameras.main.scrollX -= 48)));
    keys?.on('keydown-RIGHT', () => typing() || (onUserScroll?.(), (this.cameras.main.scrollX += 48)));
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
  }

  protected onResize() {
    this.setupCamera(this.worldWidth);
  }

  /** Crisp pixel text. `size` is in world pixels, but never under 8 screen pixels. */
  protected text(x: number, y: number, str: string, size = 5, color = '#ffffff', wrap?: number) {
    const scale = Math.max(size, 8 / this.zoom) / 8;
    const t = this.add.text(x, y, str, {
      fontFamily: FONT,
      fontSize: '8px',
      color,
      stroke: '#1a1c2c',
      strokeThickness: 3,
      align: 'center',
      wordWrap: wrap ? { width: wrap / scale, useAdvancedWrap: true } : undefined,
      lineSpacing: 2,
    });
    t.setScale(scale);
    t.setResolution(Math.min(4, Math.ceil(this.zoom * (window.devicePixelRatio || 1) * scale * 2)));
    return t;
  }

  /** Re-render on any app change until the scene shuts down. */
  /**
   * Tells the app where something is on screen (for the tour's spotlight).
   * `find` returns a world-space rectangle; it may scroll the camera to it.
   */
  protected locator(name: string, find: () => { x: number; y: number; w: number; h: number } | undefined) {
    const fn = () => {
      const r = find();
      return r && this.toScreen(r);
    };
    this.app.locators.set(name, fn);
    this.events.once('shutdown', () => this.app.locators.get(name) === fn && this.app.locators.delete(name));
  }

  /** Registers a tour demo: an animation that shows something off without changing any data. */
  protected demo(name: string, run: () => Promise<void>) {
    this.app.demos.set(name, run);
    this.events.once('shutdown', () => this.app.demos.get(name) === run && this.app.demos.delete(name));
  }

  /** A world-space rectangle in page (client) pixels. */
  protected toScreen(r: { x: number; y: number; w: number; h: number }): DOMRect {
    const cam = this.cameras.main;
    const box = this.game.canvas.getBoundingClientRect();
    const k = (box.width / this.scale.width) * cam.zoom;
    return new DOMRect(box.left + (r.x - cam.worldView.x) * k, box.top + (r.y - cam.worldView.y) * k, r.w * k, r.h * k);
  }

  /** Scrolls the camera so a world-space x range is in view. */
  protected bringIntoView(x: number, w: number) {
    const cam = this.cameras.main;
    const v = cam.worldView;
    if (x >= v.x + 8 && x + w <= v.x + v.width - 8) return;
    cam.stopFollow();
    cam.centerOnX(x + w / 2);
  }

  protected watch(fn: () => void) {
    this.unsub = this.app.subscribe(fn);
    this.events.once('shutdown', () => this.unsub?.());
  }

  protected clickable(obj: Phaser.GameObjects.GameObject & { setInteractive: Function }, onClick: () => void) {
    obj.setInteractive({ useHandCursor: true });
    obj.on('pointerup', () => {
      if (!this.dragged) onClick();
    });
    return obj;
  }

  /** Vertical gradient behind everything, covering the camera bounds. Call after setupCamera. */
  protected sky(top: string, bottom: string) {
    const g = this.add.graphics().setDepth(-100);
    const r = this.cameras.main.getBounds();
    const a = Phaser.Display.Color.HexStringToColor(top).color;
    const b = Phaser.Display.Color.HexStringToColor(bottom).color;
    g.fillStyle(a, 1).fillRect(r.x - 64, r.y, r.width + 128, -r.y + 1);
    g.fillGradientStyle(a, a, b, b, 1);
    g.fillRect(r.x - 64, 0, r.width + 128, GROUND_Y);
    this.cameras.main.setBackgroundColor(bottom);
    return g;
  }

  /** Bottom edge of the visible world (below WORLD_H on tall screens). */
  protected get floor() {
    return this.cameras.main.getBounds().bottom;
  }
}
