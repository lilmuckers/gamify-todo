import Phaser from 'phaser';
import { orderedProjects, orderedWorlds, suggestNext, totals, type GameState } from '@quest/shared';
import { go } from '../router';
import { quip, type Thing } from './quips';
import { clutter, CONSOLE_PORTS, consoleTop, SCREEN, SLOT, TV_H, TV_W, tvCanvas, wallpaperCanvas } from '../sprites/bedroom';
import { carpetCanvas, cartridge, CART_H, CART_W, controllerCanvas, type CartSpec } from '../sprites/cartridge';
import { projectForm } from '../ui/forms';
import { QuestScene } from './common';

/** Floor area in world pixels; the camera zooms to fit it. */
const FLOOR_W = 480;
const FLOOR_H = 270;
const CENTER = { x: FLOOR_W / 2, y: FLOOR_H / 2 };
/** The wall with the TV sits "above" the floor; the camera pans up to it. */
const SKIRTING_Y = -300;
const TV = { x: CENTER.x, y: SKIRTING_Y - 40 - TV_H / 2 };

interface Cart {
  key: string;
  spec: CartSpec;
  lines: string[];
  onPick: () => void;
  /** Insert into the console and boot (real games), or act at once. */
  insert: boolean;
}

interface Placed {
  x: number;
  y: number;
  angle: number;
}

/** Per-visit room layout: the console's jaunty angle and random clutter. */
interface Room {
  console: Placed;
  pad: Placed;
  powerSide: 1 | -1;
  props: (Placed & { key: string; under: boolean; kind: Thing; label?: string })[];
  carts: Placed[];
}

function rotate(p: { x: number; y: number }, deg: number) {
  const a = Phaser.Math.DegToRad(deg);
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

const cartTexture = (cart: Cart) => `cart:${cart.key}:${cart.spec.title}:${cart.spec.themes.join(',')}`;

/**
 * Title screen: a bedroom floor seen from above. Project cartridges lie around
 * a console with snacks and junk; picking one slots it in, the view looks up
 * at the TV and the game boots.
 */
export class ProjectsScene extends QuestScene {
  private layer?: Phaser.GameObjects.Container;
  private info?: Phaser.GameObjects.Container;
  private busy = false;
  private sig = '';
  private room?: Room;
  private visit = 0;
  private lastQuip?: string;

  constructor() {
    super('projects');
  }

  init() {
    super.init();
    this.layer = undefined;
    this.busy = false;
    this.sig = '';
    // New clutter every time the screen is shown.
    this.room = undefined;
    this.visit++;
  }

  create() {
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
    this.cameras.main.fadeIn(250);
    this.render();
    this.watch(() => this.render());
  }

  protected onResize() {
    if (this.busy) return;
    this.sig = '';
    this.room = undefined;
    this.render();
  }

  private carts(): Cart[] | undefined {
    const ws = this.app.workspace;
    if (!ws) return;
    const out: Cart[] = orderedProjects(ws).map((p) => this.gameCart(p));
    if (this.app.caps.canReviewPRs) {
      const n = this.app.pulls.list?.length;
      out.push({
        key: '__warp',
        spec: { seed: 'warp-zone', title: 'Warp Zone', themes: ['warp'], kind: 'warp' },
        lines: ['WARP ZONE', n === undefined ? 'Review pull requests' : `${n} PR${n === 1 ? '' : 's'} to review`],
        insert: true,
        onPick: () => go({ view: 'prs' }),
      });
      void this.app.loadPulls();
    }
    if (this.app.caps.canEdit)
      out.push({
        key: '__new',
        spec: { seed: 'blank', title: 'New', themes: [], kind: 'blank' },
        lines: ['BLANK CARTRIDGE', 'Start a new project'],
        insert: false,
        onPick: () => projectForm(this.app, true),
      });
    return out;
  }

  private gameCart(p: GameState): Cart {
    const t = totals(p);
    const next = suggestNext(p);
    const nextLevel = next && p.worlds[next.worldId]?.levels.find((l) => l.id === next.levelId);
    const id = p.overworld.id;
    return {
      key: id,
      spec: { seed: id, title: p.overworld.title, themes: orderedWorlds(p).map((w) => w.theme) },
      lines: [
        p.overworld.title,
        `${Object.keys(p.worlds).length} worlds · ${t.levelsCleared}/${t.levels} levels · ${t.stars}/${t.maxStars} stars`,
        nextLevel ? `Next: ${nextLevel.name}` : t.levels ? 'All clear!' : 'No levels yet',
      ],
      insert: true,
      onPick: () => go({ view: 'overworld', projectId: id }),
    };
  }

  /** Visible floor rectangle in world pixels. */
  private floorView() {
    const cam = this.cameras.main;
    const w = Math.min(cam.width / cam.zoom, FLOOR_W * 1.6);
    const h = Math.min(cam.height / cam.zoom, FLOOR_H * 1.6);
    return { x: CENTER.x - w / 2, y: CENTER.y - h / 2, w, h };
  }

  /**
   * Places things in the visible floor, avoiding what's already there.
   */
  private scatter(
    count: number,
    r: () => number,
    taken: { x: number; y: number; rad: number }[],
    rad: number,
    maxAngle: number,
  ): Placed[] {
    const v = this.floorView();
    const margin = rad + 6;
    const out: Placed[] = [];
    for (let i = 0; i < count; i++) {
      let best = { x: CENTER.x, y: CENTER.y, score: -Infinity };
      for (let tries = 0; tries < 90; tries++) {
        const x = v.x + margin + r() * (v.w - 2 * margin);
        const y = v.y + margin + r() * (v.h - 2 * margin);
        const gap = Math.min(...taken.map((t) => Math.hypot(t.x - x, t.y - y) - t.rad - rad), 999);
        if (gap > best.score) best = { x, y, score: gap };
        if (gap > 8) break;
      }
      const p = { x: best.x, y: best.y, angle: (r() - 0.5) * 2 * maxAngle };
      taken.push({ x: p.x, y: p.y, rad });
      out.push(p);
    }
    return out;
  }

  private makeRoom(cartCount: number): Room {
    const r = Math.random;
    const angle = (r() < 0.5 ? -1 : 1) * (8 + r() * 14);
    const console = { x: CENTER.x + (r() - 0.5) * 30, y: CENTER.y + (r() - 0.5) * 16, angle };
    const padOffset = rotate({ x: -78 - r() * 20, y: 58 + r() * 12 }, angle);
    const pad = { x: console.x + padOffset.x, y: console.y + padOffset.y, angle: angle - 25 + r() * 50 };
    const taken = [
      { x: console.x, y: console.y, rad: 62 },
      { x: pad.x, y: pad.y, rad: 28 },
      { x: CENTER.x, y: this.floorView().y + 14, rad: 40 }, // title text
    ];
    // Everything is re-thrown on each visit; only each cartridge's artwork is fixed.
    const carts = this.scatter(cartCount, r, taken, 30, 20);
    const props: Room['props'] = [];
    for (const prop of clutter()) {
      const key = `prop:${this.visit}:${props.length}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      this.textures.addCanvas(key, prop.canvas);
      const rad = Math.max(prop.canvas.width, prop.canvas.height) / 2;
      const [spot] = this.scatter(1, r, taken, rad * 0.8, 180);
      props.push({ ...spot, key, under: !!prop.under, kind: prop.kind, label: prop.label });
    }
    return { console, pad, powerSide: r() < 0.5 ? 1 : -1, props, carts };
  }

  private render() {
    const carts = this.carts();
    if (!carts || this.busy) return;
    const sig = JSON.stringify([carts.map((c) => [c.key, c.spec, c.lines]), this.scale.width, this.scale.height]);
    if (sig === this.sig) return;
    this.sig = sig;

    const cam = this.cameras.main;
    cam.setZoom(Math.max(0.5, Math.min(this.scale.width / FLOOR_W, this.scale.height / FLOOR_H)));
    cam.centerOn(CENTER.x, CENTER.y);
    cam.setBackgroundColor('#1a1c2c');

    if (!this.room || this.room.carts.length !== carts.length) this.room = this.makeRoom(carts.length);
    const room = this.room;

    this.layer?.destroy();
    this.info?.destroy();
    const layer = (this.layer = this.add.container(0, 0));
    const tex = (key: string, c: () => HTMLCanvasElement) => {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, c());
      return key;
    };

    // Wall with the TV, then the carpet from the skirting board down.
    const pad = 600;
    layer.add(this.add.tileSprite(-pad, SKIRTING_Y - 500, FLOOR_W + 2 * pad, 500, tex('wallpaper', wallpaperCanvas)).setOrigin(0));
    layer.add(this.add.rectangle(-pad, SKIRTING_Y - 8, FLOOR_W + 2 * pad, 10, 0xdfe9f0).setOrigin(0));
    layer.add(this.add.rectangle(TV.x - TV_W / 2 - 10, SKIRTING_Y - 40, TV_W + 20, 38, 0x743f39).setOrigin(0).setStrokeStyle(2, 0x1a1c2c));
    const tv = this.add.image(TV.x, TV.y, tex('tv', tvCanvas));
    layer.add(tv);
    this.mutter(layer, tv, undefined, { x: TV.x, y: TV.y, angle: 0 }, 'tv', undefined, 1.04);
    layer.add(this.add.tileSprite(-pad, SKIRTING_Y + 2, FLOOR_W + 2 * pad, FLOOR_H + pad, tex('carpet', carpetCanvas)).setOrigin(0));

    // Puddles and crumbs under everything else.
    const propImage = (p: Room['props'][number]) => this.add.image(p.x, p.y, p.key).setAngle(p.angle);
    for (const p of room.props.filter((p) => p.under)) {
      const img = propImage(p);
      layer.add(img);
      this.mutter(layer, img, undefined, p, p.kind, p.label);
    }

    // Cables: A/V up to the TV, power off-screen, controller to the pad.
    const c = room.console;
    const port = (name: keyof typeof CONSOLE_PORTS) => {
      const o = rotate(CONSOLE_PORTS[name], c.angle);
      return { x: c.x + o.x, y: c.y + o.y };
    };
    const cables = this.add.graphics();
    const cable = (from: { x: number; y: number }, to: { x: number; y: number }, bend: number, color: number) => {
      const curve = new Phaser.Curves.CubicBezier(
        new Phaser.Math.Vector2(from.x, from.y),
        new Phaser.Math.Vector2(from.x + (to.x - from.x) * 0.25 + bend, from.y + (to.y - from.y) * 0.35),
        new Phaser.Math.Vector2(from.x + (to.x - from.x) * 0.7 - bend, from.y + (to.y - from.y) * 0.7),
        new Phaser.Math.Vector2(to.x, to.y),
      );
      cables.lineStyle(3, 0x1a1c2c, 1);
      curve.draw(cables, 48);
      cables.lineStyle(1, color, 1);
      curve.draw(cables, 48);
    };
    const v = this.floorView();
    cable(port('av'), { x: TV.x + 30, y: SKIRTING_Y + 2 }, 30, 0xfee761);
    cable(port('av'), { x: TV.x + 40, y: SKIRTING_Y + 2 }, 18, 0xe43b44);
    const powerX = room.powerSide > 0 ? v.x + v.w + 40 : v.x - 40;
    cable(port('power'), { x: powerX, y: v.y + v.h * 0.3 }, -20, 0x3a4466);
    cable(port('pad1'), { x: room.pad.x + 10, y: room.pad.y - 6 }, -16, 0x5a6988);
    layer.add(cables);

    const consoleShadow = this.add.image(c.x + 3, c.y + 5, tex('console-off', () => consoleTop(false))).setAngle(c.angle).setTint(0).setAlpha(0.35);
    const consoleImg = this.add.image(c.x, c.y, 'console-off').setAngle(c.angle);
    layer.add([consoleShadow, consoleImg]);
    this.mutter(layer, consoleImg, consoleShadow, c, 'console', undefined, 1.06);
    const padImg = this.add.image(room.pad.x, room.pad.y, tex('controller', controllerCanvas)).setAngle(room.pad.angle);
    layer.add(padImg);
    this.mutter(layer, padImg, undefined, room.pad, 'controller');

    for (const p of room.props.filter((p) => !p.under)) {
      const shadow = this.add.image(p.x + 2, p.y + 3, p.key).setAngle(p.angle).setTint(0).setAlpha(0.3);
      const img = propImage(p);
      layer.add([shadow, img]);
      this.mutter(layer, img, shadow, p, p.kind, p.label);
    }

    const title = this.text(CENTER.x, v.y + 14, 'SELECT A GAME', 7, '#fee761').setOrigin(0.5);
    layer.add(title);
    this.tweens.add({ targets: title, alpha: 0.4, yoyo: true, repeat: -1, duration: 700 });

    carts.forEach((cart, i) => {
      const spot = room.carts[i];
      const key = tex(cartTexture(cart), () => cartridge(cart.spec));
      const shadow = this.add.image(spot.x + 2, spot.y + 3, key).setTint(0x000000).setAlpha(0.4).setAngle(spot.angle);
      const img = this.add.image(spot.x, spot.y, key).setAngle(spot.angle);
      layer.add([shadow, img]);
      img.setInteractive({ useHandCursor: true });
      img.on('pointerover', () => {
        if (this.busy) return;
        layer.bringToTop(shadow);
        layer.bringToTop(img);
        this.tweens.add({ targets: img, angle: 0, scale: 1.35, y: spot.y - 6, duration: 140, ease: 'Back.out' });
        this.tweens.add({ targets: shadow, angle: 0, scale: 1.35, x: spot.x + 6, y: spot.y + 8, alpha: 0.3, duration: 140 });
        this.showInfo(cart, spot.x, spot.y);
      });
      img.on('pointerout', () => {
        if (this.busy) return;
        this.tweens.add({ targets: img, angle: spot.angle, scale: 1, y: spot.y, duration: 160 });
        this.tweens.add({ targets: shadow, angle: spot.angle, scale: 1, x: spot.x + 2, y: spot.y + 3, alpha: 0.4, duration: 160 });
        this.info?.destroy();
      });
      img.on('pointerup', () => {
        if (this.busy) return;
        if (!cart.insert) return cart.onPick();
        void this.play(img, shadow, consoleImg, cart);
      });
    });
  }

  /**
   * The non-game things on the floor: hovering (or tapping) one lifts it a
   * little, like a cartridge but more half-hearted, with a muttered remark.
   */
  private mutter(
    layer: Phaser.GameObjects.Container,
    img: Phaser.GameObjects.Image,
    shadow: Phaser.GameObjects.Image | undefined,
    home: Placed,
    thing: Thing,
    label?: string,
    scale = 1.15,
  ) {
    img.setInteractive(this.input.makePixelPerfect(1));
    const sx = shadow?.x ?? 0;
    const sy = shadow?.y ?? 0;
    let up = false;
    const lift = () => {
      if (this.busy || up) return;
      up = true;
      if (shadow) layer.bringToTop(shadow);
      layer.bringToTop(img);
      const angle = home.angle / 2;
      this.tweens.add({ targets: img, angle, scale, y: home.y - 3, duration: 160, ease: 'Sine.out' });
      if (shadow) this.tweens.add({ targets: shadow, angle, scale, x: sx + 2, y: sy + 3, alpha: 0.25, duration: 160 });
      this.lastQuip = quip(thing, label, this.lastQuip);
      this.showQuip(this.lastQuip, home.x, home.y - (img.displayHeight * scale) / 2);
    };
    const drop = () => {
      if (!up) return;
      up = false;
      this.tweens.add({ targets: img, angle: home.angle, scale: 1, y: home.y, duration: 180 });
      if (shadow) this.tweens.add({ targets: shadow, angle: home.angle, scale: 1, x: sx, y: sy, alpha: 0.3, duration: 180 });
      this.info?.destroy();
    };
    img.on('pointerover', lift);
    img.on('pointerout', drop);
    // Touch has no hover: a tap mutters, another tap stops.
    img.on('pointerup', (p: Phaser.Input.Pointer) => p.wasTouch && (up ? drop() : lift()));
  }

  /** A quieter cousin of the cartridge info box: one muttered line in grey. */
  private showQuip(text: string, x: number, top: number) {
    this.info?.destroy();
    const t = this.text(0, 0, text, 4, '#c0cbdc', 120).setOrigin(0.5, 0);
    const w = t.displayWidth + 10;
    const h = t.displayHeight + 8;
    const bg = this.add.rectangle(0, -4, w, h, 0x262b44, 0.82).setOrigin(0.5, 0).setStrokeStyle(1, 0x5a6988);
    // A little tail pointing down at the thing.
    const tail = this.add.triangle(0, h - 4, -3, 0, 3, 0, 0, 4, 0x262b44, 0.82).setOrigin(0.5, 0);
    const cam = this.cameras.main;
    const above = top - h - 6 > cam.worldView.y + 4;
    const iy = above ? top - h - 2 : top + 8;
    const left = cam.worldView.x;
    const ix = Phaser.Math.Clamp(x, left + w / 2 + 4, left + cam.worldView.width - w / 2 - 4);
    tail.setX(Phaser.Math.Clamp(x - ix, -w / 2 + 5, w / 2 - 5)).setVisible(above);
    this.info = this.add.container(ix, iy, [bg, tail, t]).setDepth(1000).setAlpha(0);
    this.tweens.add({ targets: this.info, alpha: 1, duration: 120 });
  }

  private showInfo(cart: Cart, x: number, y: number) {
    this.info?.destroy();
    const [head, ...rest] = cart.lines;
    const t1 = this.text(0, 0, head, 6, '#fee761', 150).setOrigin(0.5, 0);
    const t2 = this.text(0, t1.displayHeight + 3, rest.join('\n'), 4, '#ffffff', 150).setOrigin(0.5, 0);
    const w = Math.max(t1.displayWidth, t2.displayWidth) + 12;
    const h = t1.displayHeight + t2.displayHeight + 12;
    const bg = this.add.rectangle(0, -5, w, h, 0x1a1c2c, 0.92).setOrigin(0.5, 0).setStrokeStyle(1, 0xfee761);
    // Above the cartridge, or below it near the top edge; clamped to the view.
    const cam = this.cameras.main;
    const above = y - CART_H * 0.7 - h > cam.worldView.y + 4;
    const iy = above ? y - CART_H * 0.7 - h : y + CART_H * 0.7 + 4;
    const left = cam.worldView.x;
    const ix = Phaser.Math.Clamp(x, left + w / 2 + 4, left + cam.worldView.width - w / 2 - 4);
    this.info = this.add.container(ix, iy, [bg, t1, t2]).setDepth(1000);
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => this.tweens.add({ ...config, onComplete: () => resolve() }));
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, () => resolve()));
  }

  /** Slot the cartridge in, look up at the TV, boot, then start the project. */
  private async play(img: Phaser.GameObjects.Image, shadow: Phaser.GameObjects.Image, consoleImg: Phaser.GameObjects.Image, cart: Cart) {
    this.busy = true;
    this.info?.destroy();
    this.input.enabled = false;
    shadow.setVisible(false);
    this.layer!.bringToTop(img);
    const c = this.room!.console;
    const slot = rotate(SLOT, c.angle);
    const lift = rotate({ x: 0, y: -18 }, c.angle);

    // Fly over the slot, line up with it, then stand it up: from above, an
    // inserted cartridge is just its top edge poking out of the slot.
    await this.tween({ targets: img, x: c.x + slot.x + lift.x, y: c.y + slot.y + lift.y, angle: c.angle, scale: 1.1, duration: 320, ease: 'Quad.out' });
    await this.tween({ targets: img, x: c.x + slot.x, y: c.y + slot.y, scaleX: SLOT.w / CART_W, scaleY: 0.2, duration: 200, ease: 'Quad.in' });
    this.cameras.main.shake(90, 0.004);
    if (!this.textures.exists('console-on')) this.textures.addCanvas('console-on', consoleTop(true));
    consoleImg.setTexture('console-on');
    await this.wait(250);

    // Look up at the TV.
    const cam = this.cameras.main;
    const zoom = Math.min(cam.width / (TV_W + 30), cam.height / (TV_H + 30));
    cam.pan(TV.x, TV.y, 750, 'Sine.easeInOut');
    cam.zoomTo(zoom, 750, 'Sine.easeInOut');
    await this.wait(800);
    await this.boot(cart);
    cam.fadeOut(220, 0, 0, 0);
    await this.wait(240);
    cart.onPick();
  }

  /** ~1.6 s console boot on the TV: CRT warm-up, logo, title card. */
  private async boot(cart: Cart) {
    const sx = TV.x - TV_W / 2 + SCREEN.x;
    const sy = TV.y - TV_H / 2 + SCREEN.y;
    const cx = sx + SCREEN.w / 2;
    const cy = sy + SCREEN.h / 2;
    const screen = this.add.container(0, 0).setDepth(500);
    const bg = this.add.rectangle(sx, sy, SCREEN.w, SCREEN.h, 0x000000).setOrigin(0);
    screen.add(bg);

    // CRT warm-up: a bright line that opens into the picture.
    const beam = this.add.rectangle(cx, cy, SCREEN.w, SCREEN.h, 0xf4f4f4).setScale(0.05, 0.02);
    screen.add(beam);
    await this.tween({ targets: beam, scaleX: 1, duration: 90 });
    await this.tween({ targets: beam, scaleY: 1, duration: 110 });
    bg.setFillStyle(0x124e89);
    await this.tween({ targets: beam, alpha: 0, duration: 120 });

    // Console logo drops in.
    const logo = this.text(cx, sy + 6, 'QUEST-16', 12, '#fee761').setOrigin(0.5);
    const stripes = this.add.graphics();
    ['#e43b44', '#feae34', '#63c74d', '#0099db'].forEach((col, i) =>
      stripes.fillStyle(Phaser.Display.Color.HexStringToColor(col).color).fillRect(cx - 34 + i * 17, cy + 10, 15, 3),
    );
    stripes.setAlpha(0);
    screen.add([logo, stripes]);
    await this.tween({ targets: logo, y: cy - 4, duration: 320, ease: 'Bounce.out' });
    await this.tween({ targets: stripes, alpha: 1, duration: 120 });
    await this.wait(280);
    this.cameras.main.flash(120, 255, 255, 255);
    logo.destroy();
    stripes.destroy();

    // Title card: the cartridge art, the name, and PRESS START.
    bg.setFillStyle(0x1a1c2c);
    const art = this.add.image(sx + 26, cy, cartTexture(cart)).setScale(1.4).setAlpha(0);
    const name = this.text(sx + 62, cy - 26, cart.lines[0].toUpperCase(), 6, '#ffffff', SCREEN.w - 68).setOrigin(0, 0);
    const start = this.text(sx + 62, cy + 24, 'PRESS START', 5, '#fee761').setOrigin(0, 0.5);
    screen.add([art, name, start]);
    this.tweens.add({ targets: start, alpha: 0.2, yoyo: true, repeat: -1, duration: 160 });

    // Scanlines over everything on the screen.
    const lines = this.add.graphics().setAlpha(0.18);
    lines.fillStyle(0x000000);
    for (let y = sy; y < sy + SCREEN.h; y += 2) lines.fillRect(sx, y, SCREEN.w, 1);
    screen.add(lines);
    await this.tween({ targets: art, alpha: 1, x: sx + 32, duration: 200 });
    await this.wait(520);
    this.cameras.main.flash(160, 255, 255, 255);
    await this.wait(120);
  }
}
