import Phaser from 'phaser';
import { orderedProjects, orderedWorlds, seeded, suggestNext, totals, type GameState } from '@quest/shared';
import { go } from '../router';
import { carpetCanvas, cartridge, CART_H, consoleCanvas, controllerCanvas, type CartSpec } from '../sprites/cartridge';
import { projectForm } from '../ui/forms';
import { QuestScene } from './common';

/** Floor area in world pixels; the camera zooms to fit it. */
const FLOOR_W = 480;
const FLOOR_H = 270;
const CONSOLE = { x: FLOOR_W / 2, y: FLOOR_H / 2 - 6 };
const PAD = { x: CONSOLE.x - 92, y: CONSOLE.y + 60 };

interface Cart {
  key: string;
  spec: CartSpec;
  lines: string[];
  onPick: () => void;
  /** Insert into the console before acting (real games), or act at once. */
  insert: boolean;
}

/**
 * Title screen: project cartridges scattered on the carpet around a console.
 * Hover lifts a cartridge and shows its details; clicking slots it in.
 */
export class ProjectsScene extends QuestScene {
  private layer?: Phaser.GameObjects.Container;
  private info?: Phaser.GameObjects.Container;
  private busy = false;
  private sig = '';

  constructor() {
    super('projects');
  }

  init() {
    super.init();
    this.layer = undefined;
    this.busy = false;
    this.sig = '';
  }

  create() {
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
    this.render();
    this.watch(() => this.render());
  }

  protected onResize() {
    this.sig = '';
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

  /** Seeded scatter over the visible floor, around the console, keeping cartridges apart. */
  private positions(carts: Cart[]) {
    const r = seeded(carts.map((c) => c.key).join('|'));
    const placed: { x: number; y: number; angle: number }[] = [];
    const margin = 40;
    const cam = this.cameras.main;
    const w = Math.min(cam.width / cam.zoom, FLOOR_W * 1.6);
    const hgt = Math.min(cam.height / cam.zoom, FLOOR_H * 1.6);
    const x0 = CONSOLE.x - w / 2 + margin;
    const y0 = CONSOLE.y - hgt / 2 + margin;
    for (let i = 0; i < carts.length; i++) {
      let best = { x: 0, y: 0, score: -1 };
      for (let tries = 0; tries < 80; tries++) {
        const x = x0 + r() * (w - 2 * margin);
        const y = y0 + r() * (hgt - 2 * margin);
        const dConsole = Math.hypot((x - CONSOLE.x) / 1.4, y - CONSOLE.y);
        const onTitle = Math.abs(x - CONSOLE.x) < 85 && y > CONSOLE.y - 85 && y < CONSOLE.y - 25;
        if (dConsole < 70 || onTitle || Math.hypot(x - PAD.x, y - PAD.y) < 44) continue;
        const dCart = Math.min(Infinity, ...placed.map((p) => Math.hypot(p.x - x, p.y - y)));
        const score = Math.min(dCart, 90);
        if (score > best.score) best = { x, y, score };
        if (score >= 70) break;
      }
      placed.push({ x: best.x, y: best.y, angle: (r() - 0.5) * 40 });
    }
    return placed;
  }

  private render() {
    const carts = this.carts();
    if (!carts || this.busy) return;
    const sig = JSON.stringify([carts.map((c) => [c.key, c.spec, c.lines]), this.scale.width, this.scale.height]);
    if (sig === this.sig) return;
    this.sig = sig;

    const cam = this.cameras.main;
    cam.setZoom(Math.max(0.5, Math.min(this.scale.width / FLOOR_W, this.scale.height / FLOOR_H)));
    cam.centerOn(FLOOR_W / 2, FLOOR_H / 2);
    cam.setBackgroundColor('#1a1c2c');

    this.layer?.destroy();
    this.info?.destroy();
    const layer = (this.layer = this.add.container(0, 0));
    const tex = (key: string, c: HTMLCanvasElement) => {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, c);
      return key;
    };

    // Carpet reaching past the floor so wide screens stay covered.
    const pad = 400;
    layer.add(this.add.tileSprite(-pad, -pad, FLOOR_W + 2 * pad, FLOOR_H + 2 * pad, tex('carpet', carpetCanvas())).setOrigin(0));

    // Console, controller and cable.
    const cable = this.add.graphics();
    cable.lineStyle(2, 0x1a1c2c, 1);
    const pad0 = { x: CONSOLE.x - 30, y: CONSOLE.y + 26 };
    const padAt = PAD;
    const curve = new Phaser.Curves.CubicBezier(
      new Phaser.Math.Vector2(pad0.x, pad0.y),
      new Phaser.Math.Vector2(pad0.x - 10, pad0.y + 40),
      new Phaser.Math.Vector2(padAt.x + 40, padAt.y - 30),
      new Phaser.Math.Vector2(padAt.x + 24, padAt.y),
    );
    curve.draw(cable);
    layer.add(cable);
    layer.add(this.add.image(CONSOLE.x + 3, CONSOLE.y + 4, tex('console-shadow', consoleCanvas(false))).setTint(0x000000).setAlpha(0.35));
    const consoleImg = this.add.image(CONSOLE.x, CONSOLE.y, tex('console-off', consoleCanvas(false)));
    layer.add(consoleImg);
    layer.add(this.add.image(padAt.x, padAt.y, tex('controller', controllerCanvas())).setAngle(-12));

    const title = this.text(CONSOLE.x, CONSOLE.y - 50, 'SELECT A GAME', 7, '#fee761').setOrigin(0.5);
    layer.add(title);
    this.tweens.add({ targets: title, alpha: 0.4, yoyo: true, repeat: -1, duration: 700 });

    const spots = this.positions(carts);
    carts.forEach((cart, i) => {
      const spot = spots[i];
      const key = tex(`cart:${cart.key}:${cart.spec.title}:${cart.spec.themes.join(',')}`, cartridge(cart.spec));
      const shadow = this.add.image(spot.x + 2, spot.y + 3, key).setTint(0x000000).setAlpha(0.4).setAngle(spot.angle);
      const img = this.add.image(spot.x, spot.y, key).setAngle(spot.angle).setDepth(spot.y);
      layer.add([shadow, img]);
      img.setInteractive({ useHandCursor: true, pixelPerfect: false });
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
        this.insert(img, shadow, consoleImg, cart);
      });
    });
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

  /** Slides the cartridge into the console, powers on, then starts the game. */
  private insert(img: Phaser.GameObjects.Image, shadow: Phaser.GameObjects.Image, consoleImg: Phaser.GameObjects.Image, cart: Cart) {
    this.busy = true;
    this.info?.destroy();
    shadow.setVisible(false);
    const layer = this.layer!;
    layer.bringToTop(img);
    // Slot centre on the console canvas is y=13 of 64.
    const slotY = CONSOLE.y - 32 + 13;
    const above = slotY - CART_H / 2 - 10;
    const seated = slotY - CART_H / 2 + 14;
    this.tweens.chain({
      targets: img,
      tweens: [
        {
          x: CONSOLE.x,
          y: above,
          angle: 0,
          scale: 1,
          duration: 320,
          ease: 'Quad.out',
          // Drop behind the console so the housing hides the inserted end.
          onComplete: () => layer.moveBelow(img, consoleImg),
        },
        {
          y: seated,
          duration: 200,
          ease: 'Quad.in',
          onComplete: () => {
            if (!this.textures.exists('console-on')) this.textures.addCanvas('console-on', consoleCanvas(true));
            consoleImg.setTexture('console-on');
            this.cameras.main.flash(250, 255, 255, 255);
          },
        },
      ],
      onComplete: () => this.time.delayedCall(280, () => cart.onPick()),
    });
  }
}
