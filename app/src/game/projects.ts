import Phaser from 'phaser';
import { orderedProjects, orderedWorlds, suggestNextLevel, totals, type GameState } from '@quest/shared';
import { go } from '../router';
import { uiPrefs, urlMode } from '../config';
import { track } from '../analytics';
import { quip, type Thing } from './quips';
import { JUNK_KINDS, junkLine, type JunkKind } from './junk-lines';
import { activePad } from './play/input';
import { clutter, everyKind, CONSOLE_PORTS, CONSOLE_W, consoleTop, SCREEN, SLOT, TV_H, TV_W, tvCanvas, wallpaperCanvas } from '../sprites/bedroom';
import { JUNK_SCALE, junkScreen, junkTitle, pickVariant, staticFrame } from '../sprites/junk-tv';
import { showDialogue, type Dialogue } from '../ui/dialogue';
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
  props: (Placed & { key: string; under: boolean; kind: Thing; label?: string; colors?: string[] })[];
  carts: Placed[];
  /** What can go in the console this visit: props' indexes, and -1 for the controller. One thing, or all of them with `?jam`. */
  junk: Set<number>;
}

/** The easter egg in progress: something that isn't a game, jammed in the console. */
interface Egg {
  kind: JunkKind;
  colors?: string[];
  /** Which of the kind's TV screens is showing. */
  variant: number;
  img: Phaser.GameObjects.Image;
  shadow?: Phaser.GameObjects.Image;
  shadowAt?: { x: number; y: number };
  home: Placed;
  /** Where the thing lands when ejected: its home, or the juice cup's spot beside its puddle. */
  back: { x: number; y: number };
  /** Juice drips, snack crumbs, soda fizz and the gamebook's die, cleared when the egg ends. */
  drips: Phaser.GameObjects.GameObject[];
  /** The juice's drip timer. A reset kills the insert's tweens mid-way, so it can't stop itself. */
  dripping?: Phaser.Time.TimerEvent;
  screen?: Phaser.GameObjects.Container;
  /** Texture of the title screen on the TV, freed when the egg ends. */
  screenKey?: string;
  dialogue?: Dialogue;
  /** Esc, a click away or leaving the screen: stop at the next step and reset. */
  cancelled: boolean;
  resetting: boolean;
  /** Gamepad A/B last frame, for presses. */
  padA: boolean;
  padB: boolean;
}

/** Things that can go in the console, when this visit picks them. */
const JUNKABLE = new Set<string>(JUNK_KINDS);
/** The juice cup within its prop picture: centre and height (it spans x 0–29). */
const CUP = { x: 14, y: 22, h: 18 };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  private lastJunkLine?: string;
  /** The screen each kind showed last, so the next go shows another. */
  private lastVariant = new Map<string, number>();
  private egg?: Egg;
  private consoleImg?: Phaser.GameObjects.Image;
  /** Camera zoom on the floor (the TV visit zooms in, then back to this). */
  private floorZoom = 1;
  /** The window was resized during the easter egg: re-lay the room after. */
  private resized = false;
  /** Prop textures the current room uses (kept across visits so old ones can be freed). */
  private propKeys = new Set<string>();

  constructor() {
    super('projects');
  }

  init() {
    super.init();
    this.layer = undefined;
    this.busy = false;
    this.egg = undefined;
    this.sig = '';
    // New clutter every time the screen is shown.
    this.room = undefined;
    this.visit++;
  }

  create() {
    this.listenResize();
    // Leaving mid-egg (the HUD still works): take the box and key handler with us.
    this.events.once('shutdown', () => this.egg && this.endEgg());
    this.cameras.main.fadeIn(250);
    this.render();
    this.watch(() => this.render());
    // The tour points at the first cartridge on the floor.
    this.locator('cartridge', () => {
      const spot = this.room?.carts[0];
      return spot && { x: spot.x - CART_W * 0.75, y: spot.y - CART_H * 0.75, w: CART_W * 1.5, h: CART_H * 1.5 };
    });
  }

  protected onResize() {
    if (this.busy) {
      this.resized = true;
      return;
    }
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
    const nextLevel = suggestNextLevel(p)?.level;
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

  /** @param near the cartridge (index) that waits beside the console: the project last played. */
  private makeRoom(cartCount: number, near = -1): Room {
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
    // The last game played sits just right of the console, ready to go back in.
    let last: Placed | undefined;
    if (near >= 0 && near < cartCount) {
      const o = rotate({ x: CONSOLE_W / 2 + CART_W / 2 + 12, y: 10 }, angle);
      last = { x: console.x + o.x, y: console.y + o.y, angle: angle + (r() - 0.5) * 16 };
      taken.push({ x: last.x, y: last.y, rad: 30 });
    }
    // Everything is re-thrown on each visit; only each cartridge's artwork is fixed.
    const carts = this.scatter(last ? cartCount - 1 : cartCount, r, taken, 30, 20);
    if (last) carts.splice(near, 0, last);
    const props: Room['props'] = [];
    const jam = urlMode().jam;
    for (const prop of jam ? everyKind() : clutter()) {
      const key = `prop:${this.visit}:${props.length}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      this.textures.addCanvas(key, prop.canvas);
      const rad = Math.max(prop.canvas.width, prop.canvas.height) / 2;
      const [spot] = this.scatter(1, r, taken, rad * 0.8, 180);
      props.push({ ...spot, key, under: !!prop.under, kind: prop.kind, label: prop.label, colors: prop.colors });
    }
    // One thing per visit can be jammed in the console: never crumbs or puddles.
    const junkable = [-1, ...props.flatMap((p, i) => (!p.under && JUNKABLE.has(p.kind) ? [i] : []))];
    const junk = new Set(jam ? junkable : [junkable[Math.floor(r() * junkable.length)]]);
    return { console, pad, powerSide: r() < 0.5 ? 1 : -1, props, carts, junk };
  }

  private render() {
    const carts = this.carts();
    if (!carts || this.busy) return;
    const sig = JSON.stringify([carts.map((c) => [c.key, c.spec, c.lines]), this.scale.width, this.scale.height]);
    if (sig === this.sig) return;
    this.sig = sig;

    const cam = this.cameras.main;
    this.floorZoom = Math.max(0.5, Math.min(this.scale.width / FLOOR_W, this.scale.height / FLOOR_H));
    cam.setZoom(this.floorZoom);
    cam.centerOn(CENTER.x, CENTER.y);
    cam.setBackgroundColor('#1a1c2c');

    if (!this.room || this.room.carts.length !== carts.length) {
      const last = uiPrefs().lastProject;
      this.room = this.makeRoom(carts.length, last ? carts.findIndex((c) => c.key === last) : -1);
    }
    const room = this.room;

    this.layer?.destroy();
    this.info?.destroy();
    // Each visit throws new clutter: free the last room's textures once nothing shows them.
    for (const key of this.propKeys) if (!room.props.some((p) => p.key === key)) this.textures.remove(key);
    this.propKeys = new Set(room.props.map((p) => p.key));
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
    const consoleImg = (this.consoleImg = this.add.image(c.x, c.y, 'console-off').setAngle(c.angle));
    layer.add([consoleShadow, consoleImg]);
    this.mutter(layer, consoleImg, consoleShadow, c, 'console', undefined, 1.06);
    const padImg = this.add.image(room.pad.x, room.pad.y, tex('controller', controllerCanvas)).setAngle(room.pad.angle);
    layer.add(padImg);
    this.mutter(layer, padImg, undefined, room.pad, 'controller', undefined, 1.15, room.junk.has(-1) ? { kind: 'controller' } : undefined);

    room.props.forEach((p, i) => {
      if (p.under) return;
      const shadow = this.add.image(p.x + 2, p.y + 3, p.key).setAngle(p.angle).setTint(0).setAlpha(0.3);
      const img = propImage(p);
      layer.add([shadow, img]);
      const junk = room.junk.has(i) ? { kind: p.kind as JunkKind, label: p.label, colors: p.colors } : undefined;
      this.mutter(layer, img, shadow, p, p.kind, p.label, 1.15, junk);
    });

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
    junk?: { kind: JunkKind; label?: string; colors?: string[] },
  ) {
    // This visit's junk gets the hand cursor: it can go in the console.
    img.setInteractive({ pixelPerfect: true, alphaTolerance: 1, useHandCursor: !!junk });
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
      this.showQuip(junk ? `${this.lastQuip}\n...wonder if it fits?` : this.lastQuip, home.x, home.y - (img.displayHeight * scale) / 2);
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
    const play = () => {
      up = false;
      void this.playJunk({ ...junk!, img, shadow, home, label: junk!.label });
    };
    img.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.busy || this.dragged) return;
      // Touch has no hover: a tap mutters (and, for the junk, a second tap plays it).
      if (p.wasTouch) {
        if (junk && up) return play();
        return up ? drop() : lift();
      }
      if (junk) play();
    });
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

  // ---- Easter egg: something that isn't a game, in the console ----

  /**
   * Squashes this visit's junk into the console, boots it, shows a silly
   * title screen on the TV and lets the hero comment on it. Closing the
   * dialogue (or Esc, or clicking away) puts everything back as it was.
   */
  private async playJunk(j: { kind: JunkKind; label?: string; colors?: string[]; img: Phaser.GameObjects.Image; shadow?: Phaser.GameObjects.Image; home: Placed }) {
    if (this.busy || !this.room) return;
    this.busy = true;
    this.info?.destroy();
    // A different screen from last time this kind went in.
    const variant = pickVariant(j.kind, this.lastVariant.get(j.kind));
    this.lastVariant.set(j.kind, variant);
    track('junk_play', { kind: j.kind, variant });
    const egg: Egg = { kind: j.kind, colors: j.colors, variant, img: j.img, shadow: j.shadow, shadowAt: j.shadow && { x: j.shadow.x, y: j.shadow.y }, home: j.home, back: j.home, drips: [], cancelled: false, resetting: false, padA: true, padB: true };
    this.egg = egg;
    window.addEventListener('keydown', this.onEggKey, true);
    // A click on the scene (not the dialogue box) bails out; skip the click that started it.
    this.time.delayedCall(0, () => this.egg === egg && this.input.on('pointerup', this.onEggClick));
    const calm = reducedMotion();
    const stop = () => egg.cancelled || this.egg !== egg;

    this.tweens.killTweensOf([j.img, ...(j.shadow ? [j.shadow] : [])]);
    j.shadow?.setVisible(false);
    this.layer!.bringToTop(j.img);
    if (calm) j.img.setVisible(false);
    else await this.insertJunk(egg);
    if (stop()) return;
    if (!this.textures.exists('console-on')) this.textures.addCanvas('console-on', consoleTop(true));
    this.consoleImg?.setTexture('console-on');

    // Up to the TV.
    const cam = this.cameras.main;
    const zoom = Math.min(cam.width / (TV_W + 30), cam.height / (TV_H + 30));
    if (calm) {
      cam.setZoom(zoom);
      cam.centerOn(TV.x, TV.y);
    } else {
      await this.wait(250);
      if (stop()) return;
      cam.pan(TV.x, TV.y, 750, 'Sine.easeInOut');
      cam.zoomTo(zoom, 750, 'Sine.easeInOut');
      await this.wait(800);
    }
    if (stop()) return;
    await this.junkTv(egg, j.colors, j.label);
    if (stop()) return;

    // The hero has something to say about it.
    const line = junkLine(this.app.heroId, j.kind, { label: j.label, game: junkTitle(j.kind, variant, j.label) }, this.lastJunkLine);
    this.lastJunkLine = line.text;
    const host = this.game.canvas.parentElement ?? document.body;
    egg.dialogue = showDialogue({ hero: this.app.heroId, line, host, px: Math.max(2, Math.min(4, Math.round(this.floorZoom * 1.6))), instant: calm });
    await egg.dialogue.closed;
    if (this.egg === egg) await this.resetJunk(egg, false);
  }

  /**
   * Closes in on the console, lifts the thing over the slot and squashes it in,
   * with a bit of comedy per kind. Each bit takes a second or so, close up,
   * because at floor zoom the thing is a few pixels across and it all reads as
   * a spin and a squish.
   */
  private async insertJunk(egg: Egg) {
    const { img, kind } = egg;
    const c = this.room!.console;
    const slot = rotate(SLOT, c.angle);
    const at = { x: c.x + slot.x, y: c.y + slot.y };
    /** A point `x` along the console and `y` above the slot (negative is up). */
    const near = (x: number, y = -24) => {
      const o = rotate({ x, y }, c.angle);
      return { x: at.x + o.x, y: at.y + o.y };
    };
    const above = near(0);
    if (kind === 'juice') this.pickUpCup(egg);
    const fit = Math.min(1, SLOT.w / (kind === 'juice' ? 29 : Math.max(img.width, img.height)));
    const gone = () => egg.cancelled;
    const cam = this.cameras.main;
    const close = Math.max(this.floorZoom, Math.min(cam.width / 230, cam.height / 170));
    cam.pan(at.x, at.y - 10, 450, 'Sine.easeInOut');
    cam.zoomTo(close, 450, 'Sine.easeInOut');

    // Juice drips all the way there.
    if (kind === 'juice') egg.dripping = this.time.addEvent({ delay: 45, loop: true, callback: () => this.drip(egg) });
    await this.tween({ targets: img, ...above, angle: c.angle, scale: 1.1, duration: 450, ease: 'Quad.out' });
    if (gone()) return;

    if (kind === 'sock') {
      // Dangled by the toe, swinging, then stuffed in a shove at a time.
      for (const a of [32, -26, 16, 0]) await this.tween({ targets: img, angle: c.angle + a, duration: 200, ease: 'Sine.inOut' });
      for (const [i, s] of [0.7, 0.45, 0.25].entries()) {
        const p = near(0, -24 * s);
        await this.tween({ targets: img, ...p, scaleX: fit * 0.9, scaleY: s * 1.1, duration: 170, ease: 'Quad.in' });
        this.cameras.main.shake(70, 0.004);
        this.pop(egg, i === 2 ? 'STUFF!' : 'SHOVE', near(18 * (i % 2 ? -1 : 1), -30));
        await this.wait(200);
        if (gone()) return;
      }
    }
    if (kind === 'snack') {
      // Upended and shaken hard for the last crumbs, then crammed in with a crinkle.
      await this.tween({ targets: img, angle: '+=180', duration: 260, ease: 'Back.out' });
      this.pop(egg, 'SHAKE SHAKE', near(0, -46));
      for (let i = 0; i < 4; i++) {
        await this.tween({ targets: img, y: above.y - 10, duration: 80, ease: 'Quad.out' });
        await this.tween({ targets: img, y: above.y, duration: 80, ease: 'Quad.in' });
        for (let k = 0; k < 3; k++) this.crumb(egg, i * 3 + k);
      }
      await this.tween({ targets: img, angle: '+=180', duration: 220, ease: 'Quad.inOut' });
      this.pop(egg, 'CRINKLE', near(20, -40));
      await this.tween({ targets: img, scaleX: 0.7, duration: 90, yoyo: true, repeat: 2 });
    }
    if (kind === 'soda') {
      // Shaken up good and proper; it fizzes out of the slot once it's in.
      this.pop(egg, 'SHAKE!', near(0, -46));
      for (let i = 0; i < 6; i++) {
        const d = i % 2 ? -1 : 1;
        await this.tween({ targets: img, x: above.x + 5 * d, angle: c.angle + 18 * d, duration: 55, ease: 'Sine.inOut' });
      }
      await this.tween({ targets: img, x: above.x, angle: c.angle, duration: 60 });
    }
    if (kind === 'juice') {
      // Tipped over the slot and squeezed: splosh.
      await this.tween({ targets: img, angle: c.angle + 70, duration: 220, ease: 'Back.out' });
      for (let i = 0; i < 3; i++) {
        await this.tween({ targets: img, scaleX: 0.75, duration: 110, yoyo: true, ease: 'Quad.out' });
        this.splash(egg, near(0, -10));
        if (i === 1) this.pop(egg, 'SPLOSH', near(-22, -40));
      }
      await this.tween({ targets: img, angle: c.angle, duration: 160 });
    }
    if (kind === 'pizza') {
      // Folded in half to fit, sags, and drips a bit of grease on the way in.
      await this.tween({ targets: img, scaleX: 0.5, angle: c.angle + 14, duration: 280, ease: 'Back.in' });
      this.pop(egg, 'FOLD', near(-20, -42));
      await this.tween({ targets: img, scaleY: 1.4, y: above.y + 4, duration: 260, ease: 'Sine.inOut', yoyo: true });
      this.grease(egg, near(4, -14));
      await this.tween({ targets: img, angle: c.angle, duration: 120 });
    }
    if (kind === 'comic') {
      // Rolled up into a tube, then posted like a letterbox: it springs back once.
      this.pop(egg, 'ROLL', near(-20, -42));
      for (const a of [-12, 12, -8, 0]) await this.tween({ targets: img, scaleX: Math.max(0.22, img.scaleX - 0.24), angle: c.angle + a, duration: 100 });
      await this.tween({ targets: img, ...near(0, -6), scaleY: 0.5, duration: 140, ease: 'Quad.in' });
      await this.tween({ targets: img, ...above, scaleY: 1.1, duration: 220, ease: 'Back.out' });
      this.pop(egg, 'BOING', near(18, -42));
      await this.wait(160);
    }
    if (kind === 'controller') {
      // Still plugged in: the cable yanks it back twice before a big tug gets it there.
      const home = egg.home;
      const back = (f: number) => ({ x: above.x + (home.x - above.x) * f, y: above.y + (home.y - above.y) * f });
      await this.tween({ targets: img, ...back(0.35), angle: c.angle - 25, duration: 120, ease: 'Back.out' });
      this.cameras.main.shake(80, 0.005);
      this.pop(egg, 'YANK!', near(-30, -50));
      await this.wait(220);
      await this.tween({ targets: img, ...back(0.1), angle: c.angle, duration: 260, ease: 'Quad.in' });
      await this.tween({ targets: img, ...back(0.3), angle: c.angle - 18, duration: 110, ease: 'Back.out' });
      this.cameras.main.shake(80, 0.005);
      await this.wait(200);
      this.pop(egg, 'TUG!', near(0, -46));
      await this.tween({ targets: img, ...above, angle: c.angle, duration: 180, ease: 'Quad.in' });
    }
    if (kind === 'cassette') {
      // Stood on its edge and clunked in like a tape deck, which spits it straight back out.
      await this.tween({ targets: img, angle: c.angle + 90, scaleX: 1, duration: 220, ease: 'Back.out' });
      await this.tween({ targets: img, angle: c.angle, duration: 120 });
      await this.tween({ targets: img, ...near(0, -4), scaleY: 0.3, duration: 160, ease: 'Quad.in' });
      this.pop(egg, 'CLUNK', near(-20, -38));
      this.cameras.main.shake(70, 0.004);
      await this.wait(260);
      await this.tween({ targets: img, ...near(0, -40), scaleY: 1.1, angle: c.angle + 25, duration: 220, ease: 'Quad.out' });
      this.pop(egg, 'EJECT', near(22, -50), '#e43b44');
      await this.tween({ targets: img, ...above, angle: c.angle, duration: 240, ease: 'Bounce.out' });
      await this.wait(160);
    }
    if (kind === 'banana') {
      // Skids straight past the slot in a spin, then sheepishly slides back.
      await this.tween({ targets: img, ...near(52, -14), angle: c.angle + 300, duration: 380, ease: 'Quad.out' });
      this.cameras.main.shake(90, 0.004);
      this.pop(egg, 'WHOOPS', near(44, -46));
      await this.wait(380);
      await this.tween({ targets: img, ...above, angle: c.angle + 360, duration: 600, ease: 'Sine.inOut' });
    }
    if (kind === 'duck') {
      // Squeak, squeak: it squashes and stretches and won't go quietly.
      for (let i = 0; i < 3; i++) {
        await this.tween({ targets: img, scaleX: 1.6, scaleY: 0.6, duration: 120, ease: 'Quad.out' });
        this.pop(egg, 'SQUEAK!', near(i % 2 ? -22 : 22, -40));
        await this.tween({ targets: img, scaleX: 0.8, scaleY: 1.4, duration: 130, ease: 'Quad.in' });
        await this.wait(110);
      }
    }
    if (kind === 'donut') {
      // Stood on its edge and rolled along the console, hopping, before it drops in.
      await this.tween({ targets: img, scaleX: 0.35, duration: 180 });
      for (const [x, ms] of [[-42, 420], [40, 620], [0, 360]]) {
        // A little hop half-way, like it's caught a crumb.
        this.tweens.add({ targets: img, scaleY: 1.25, duration: ms / 2, yoyo: true, ease: 'Sine.out' });
        await this.tween({ targets: img, ...near(x, -20), duration: ms, ease: 'Sine.inOut' });
        if (gone()) return;
      }
      this.pop(egg, 'WOBBLE', near(0, -46));
      for (const a of [18, -12, 7, 0]) await this.tween({ targets: img, angle: c.angle + a, duration: 110 });
    }
    if (kind === 'teddy') {
      // Squeezed in a long hug, pops back out, and is squeezed again more gently.
      await this.tween({ targets: img, scaleX: 0.5, scaleY: 1.2, duration: 420, ease: 'Sine.inOut' });
      await this.tween({ targets: img, scaleX: 1.35, scaleY: 0.95, duration: 160, ease: 'Back.out' });
      this.pop(egg, 'BOING', near(22, -42));
      this.cameras.main.shake(60, 0.003);
      await this.wait(240);
      this.pop(egg, 'SQUISH', near(-22, -42));
      await this.tween({ targets: img, scaleX: 0.5, scaleY: 1.2, duration: 600, ease: 'Sine.inOut' });
      await this.wait(160);
    }
    if (kind === 'yoyo') {
      // Thrown down on its string and back up three times, then let go into the slot.
      const hand = near(0, -64);
      const line = this.add.graphics();
      this.layer?.add(line);
      egg.drips.push(line);
      const string = () => line.clear().lineStyle(1, 0xf4f4f4, 1).lineBetween(hand.x, hand.y, img.x, img.y);
      await this.tween({ targets: img, ...near(0, -50), duration: 150, onUpdate: string });
      for (let i = 0; i < 3; i++) {
        await this.tween({ targets: img, ...near(0, -6), angle: '+=360', duration: 220, ease: 'Quad.in', onUpdate: string });
        await this.tween({ targets: img, ...near(0, -50), angle: '+=360', duration: 240, ease: 'Quad.out', onUpdate: string });
        if (gone()) return;
      }
      line.clear();
      this.pop(egg, 'SNAP', hand);
      await this.tween({ targets: img, ...above, duration: 120 });
    }
    if (kind === 'gamebook') {
      // Riffled open and shut to peek at the ending, then a die rolls off it and across the console.
      this.pop(egg, 'FLIP FLIP', near(0, -50));
      for (let i = 0; i < 3; i++) {
        await this.tween({ targets: img, scaleX: -1.1, duration: 110, ease: 'Sine.inOut' });
        await this.tween({ targets: img, scaleX: 1.1, duration: 110, ease: 'Sine.inOut' });
      }
      const die = this.add.rectangle(img.x, img.y, 6, 6, 0xf4f4f4).setStrokeStyle(1, 0x1a1c2c);
      this.layer?.add(die);
      egg.drips.push(die);
      for (const [x, y] of [[20, -6], [36, 6], [46, 14]]) {
        await this.tween({ targets: die, ...near(x, y), angle: '+=180', duration: 200, ease: 'Quad.out' });
        if (gone()) return;
      }
      this.pop(egg, `${Phaser.Math.Between(1, 6)}!`, near(46, -10), '#fee761');
      await this.wait(260);
    }
    if (gone()) return;
    const squash = kind === 'comic' ? fit * 0.4 : kind === 'pizza' || kind === 'teddy' || kind === 'donut' ? fit * 0.6 : fit;
    await this.tween({ targets: img, ...at, angle: c.angle, scaleX: squash, scaleY: 0.18, duration: 220, ease: 'Quad.in' });
    egg.dripping?.remove();
    this.cameras.main.shake(90, 0.004);
    if (kind === 'soda' && !gone()) {
      this.fizz(egg, at);
      this.pop(egg, 'FZZZT!', near(0, -40), '#2ce8f5');
      await this.wait(500);
    }
  }

  /**
   * The juice prop is a cup lying in its own puddle, drawn as one picture.
   * Leave a copy cropped to the puddle behind and carry just the cup, pivoting
   * on its middle (the numbers match `juice()` in sprites/bedroom.ts).
   */
  private pickUpCup(egg: Egg) {
    const { img, home } = egg;
    const puddle = this.add.image(home.x, home.y, img.texture.key).setAngle(home.angle).setCrop(29, 0, 31, 44);
    this.layer?.addAt(puddle, this.layer.getIndex(img));
    egg.drips.push(puddle);
    const dx = CUP.x - img.width / 2;
    const shift = rotate({ x: dx * img.scaleX, y: 0 }, img.angle);
    img.setCrop(0, CUP.y - CUP.h / 2, 29, CUP.h).setOrigin(CUP.x / img.width, 0.5);
    img.setPosition(img.x + shift.x, img.y + shift.y);
    const off = rotate({ x: dx, y: 0 }, home.angle);
    egg.back = { x: home.x + off.x, y: home.y + off.y };
  }

  /** A sound word that pops up beside the action and floats away. Cleared with the drips. */
  private pop(egg: Egg, word: string, p: { x: number; y: number }, color = '#ffffff') {
    const t = this.text(p.x, p.y, word, 6, color).setOrigin(0.5).setDepth(400).setAlpha(0);
    egg.drips.push(t);
    this.tweens.add({ targets: t, alpha: 1, duration: 80 });
    this.tweens.add({ targets: t, y: p.y - 12, angle: Phaser.Math.Between(-10, 10), duration: 700, ease: 'Quad.out' });
    this.tweens.add({ targets: t, alpha: 0, delay: 500, duration: 250 });
  }

  /** Little bits flung from `p` that land around it: crumbs, juice. */
  private fling(egg: Egg, p: { x: number; y: number }, color: number, n: number, size = 2) {
    for (let i = 0; i < n; i++) {
      const d = this.add.rectangle(p.x, p.y, size, size, color);
      this.layer?.add(d);
      egg.drips.push(d);
      const dx = Phaser.Math.Between(-22, 22);
      void this.tween({ targets: d, x: p.x + dx, y: p.y + Phaser.Math.Between(16, 34), duration: Phaser.Math.Between(240, 360), ease: 'Bounce.out' });
    }
  }

  /** Crumbs fall out of the upended snack bag. */
  private crumb(egg: Egg, i: number) {
    const color = Phaser.Display.Color.HexStringToColor(['#fee761', '#feae34', '#e4a672'][i % 3]).color;
    this.fling(egg, { x: egg.img.x + Phaser.Math.Between(-6, 6), y: egg.img.y + 10 }, color, 1);
  }

  /** A squeeze of the carton splashes juice about. */
  private splash(egg: Egg, p: { x: number; y: number }) {
    this.fling(egg, p, this.junkColour(egg), 5);
  }

  /** One drop of grease off the folded pizza. */
  private grease(egg: Egg, p: { x: number; y: number }) {
    this.fling(egg, p, 0xfeae34, 2, 3);
  }

  /** Bubbles fizz up out of the slot after the shaken can goes in. */
  private fizz(egg: Egg, at: { x: number; y: number }) {
    for (let i = 0; i < 16; i++) {
      const b = this.add.circle(at.x + Phaser.Math.Between(-10, 10), at.y, Phaser.Math.Between(1, 3), 0xc0cbdc).setStrokeStyle(1, 0xf4f4f4);
      this.layer?.add(b);
      egg.drips.push(b);
      this.tweens.add({ targets: b, y: at.y - Phaser.Math.Between(18, 46), x: b.x + Phaser.Math.Between(-10, 10), alpha: 0, delay: i * 40, duration: 600, ease: 'Sine.out' });
    }
  }

  private junkColour(egg: Egg) {
    return Phaser.Display.Color.HexStringToColor(egg.colors?.[0] ?? '#f77622').color;
  }

  private drip(egg: Egg) {
    const d = this.add.rectangle(egg.img.x + Phaser.Math.Between(-4, 4), egg.img.y + 6, 2, 2, this.junkColour(egg));
    this.layer?.add(d);
    egg.drips.push(d);
  }

  /** Static, then the thing's title screen, with scanlines. */
  private async junkTv(egg: Egg, colors?: string[], label?: string) {
    const cx = TV.x - TV_W / 2 + SCREEN.x + SCREEN.w / 2;
    const cy = TV.y - TV_H / 2 + SCREEN.y + SCREEN.h / 2;
    const screen = this.add.container(cx, cy).setDepth(500);
    egg.screen = screen;
    screen.add(this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000));
    const key = `junk:${this.visit}:${egg.kind}:${egg.variant}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, junkScreen({ kind: egg.kind, colors, label }, egg.variant));
    egg.screenKey = key;
    const pic = this.add.image(0, 0, key).setScale(JUNK_SCALE);
    const lines = this.add.graphics().setAlpha(0.18);
    lines.fillStyle(0x000000);
    for (let y = -SCREEN.h / 2; y < SCREEN.h / 2; y += 2) lines.fillRect(-SCREEN.w / 2, y, SCREEN.w, 1);
    if (reducedMotion()) {
      screen.add([pic, lines]);
      return;
    }
    // Warm-up line, then a few frames of static.
    const beam = this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0xf4f4f4).setScale(1, 0.02);
    screen.add(beam);
    await this.tween({ targets: beam, scaleY: 1, alpha: 0.2, duration: 120 });
    beam.destroy();
    const fuzz = this.add.image(0, 0, this.staticKey(0)).setScale(JUNK_SCALE);
    screen.add(fuzz);
    for (let i = 1; i < 5; i++) {
      await this.wait(60);
      if (egg.cancelled) return;
      fuzz.setTexture(this.staticKey(i % 3));
    }
    fuzz.destroy();
    screen.add([pic, lines]);
    // One last flicker as the picture settles.
    await this.tween({ targets: pic, alpha: 0.4, yoyo: true, duration: 70 });
  }

  private staticKey(i: number) {
    const key = `tv-static:${i}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, staticFrame(i + 1));
    return key;
  }

  /**
   * The TV switches off (to a line, then a dot), the view drops back to the
   * floor and the console spits the thing back out to where it was. `fast`
   * skips the show (Esc, clicking away, leaving).
   */
  private async resetJunk(egg: Egg, fast: boolean) {
    if (egg.resetting) return;
    egg.resetting = true;
    egg.cancelled = true;
    this.unhookEgg();
    egg.dialogue?.close();
    const calm = fast || reducedMotion();
    const cam = this.cameras.main;
    const screen = egg.screen;
    if (screen && !calm) {
      await this.tween({ targets: screen, scaleY: 0.02, duration: 140, ease: 'Quad.in' });
      await this.tween({ targets: screen, scaleX: 0.02, duration: 120, ease: 'Quad.in' });
      await this.tween({ targets: screen, alpha: 0, duration: 120 });
    }
    screen?.destroy();
    this.consoleImg?.setTexture('console-off');
    cam.panEffect.reset();
    cam.zoomEffect.reset();
    const { img, home } = egg;
    this.tweens.killTweensOf(img);
    img.setVisible(true);
    if (calm) {
      cam.setZoom(this.floorZoom);
      cam.centerOn(CENTER.x, CENTER.y);
      img.setPosition(home.x, home.y).setAngle(home.angle).setScale(1);
    } else {
      cam.pan(CENTER.x, CENTER.y, 650, 'Sine.easeInOut');
      cam.zoomTo(this.floorZoom, 650, 'Sine.easeInOut');
      await this.wait(500);
      // Ejected: pops out of the slot and lands back on its spot.
      await this.tween({ targets: img, scaleX: 1, scaleY: 1, y: img.y - 26, duration: 180, ease: 'Quad.out' });
      await this.tween({ targets: img, ...egg.back, angle: home.angle, duration: 320, ease: 'Bounce.out' });
    }
    this.endEgg();
  }

  /** Puts the room back as it was (shadow, drips, input) and lets the cartridges play again. */
  private endEgg() {
    const egg = this.egg;
    if (!egg) return;
    this.unhookEgg();
    egg.dialogue?.close();
    egg.screen?.destroy();
    // Keyed per visit, so it would never be shown again: don't let them pile up.
    if (egg.screenKey) this.textures.remove(egg.screenKey);
    egg.dripping?.remove();
    this.tweens.killTweensOf(egg.drips);
    for (const d of egg.drips) d.destroy();
    if (egg.shadow && egg.shadowAt) egg.shadow.setVisible(true).setPosition(egg.shadowAt.x, egg.shadowAt.y).setAngle(egg.home.angle).setScale(1);
    if (egg.img.active) egg.img.setCrop().setOrigin(0.5).setVisible(true).setPosition(egg.home.x, egg.home.y).setAngle(egg.home.angle).setScale(1);
    this.egg = undefined;
    this.busy = false;
    if (this.resized) {
      this.resized = false;
      this.onResize();
    }
  }

  private unhookEgg() {
    window.removeEventListener('keydown', this.onEggKey, true);
    this.input.off('pointerup', this.onEggClick);
  }

  /** Enter or Space moves the dialogue on; Esc stops the whole thing. */
  private onEggKey = (e: KeyboardEvent) => {
    const egg = this.egg;
    if (!egg || egg.resetting) return;
    if (e.key === 'Escape') void this.resetJunk(egg, true);
    else if ((e.key === 'Enter' || e.key === ' ') && egg.dialogue) egg.dialogue.advance();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  /** Clicking the scene (anywhere but the dialogue box) resets early. */
  private onEggClick = (p: Phaser.Input.Pointer) => {
    // Phaser also hears releases elsewhere on the page (the dialogue box, the HUD).
    if (p.event?.target !== this.game.canvas) return;
    const egg = this.egg;
    if (egg && !egg.resetting) void this.resetJunk(egg, true);
  };

  /** Gamepad: A moves the dialogue on, B stops. */
  update() {
    const egg = this.egg;
    if (!egg || egg.resetting) return;
    const pad = activePad();
    const a = !!pad?.buttons[0]?.pressed;
    const b = !!pad?.buttons[1]?.pressed;
    if (a && !egg.padA) egg.dialogue?.advance();
    if (b && !egg.padB) void this.resetJunk(egg, true);
    egg.padA = a;
    egg.padB = b;
  }
}
