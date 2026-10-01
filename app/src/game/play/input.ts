import Phaser from 'phaser';
import type { PlayInput } from './physics';

/** One frame of controls: movement plus menu-ish presses for bubbles and leaving. */
export interface Controls extends PlayInput {
  leftPressed: boolean;
  rightPressed: boolean;
  /** Up: open the bubble for the thing the hero is at. */
  upPressed: boolean;
  /** A / Space: jump, or press the focused bubble button. */
  confirmPressed: boolean;
  /** B: back out of picking a bubble button, or close the bubble. */
  backPressed: boolean;
  /** Start / Select: leave play mode. */
  quitPressed: boolean;
  /** Esc: back out of a bubble, or (with none to back out of) leave play mode. */
  escPressed: boolean;
  /** Y / E: show or hide the bubble of whatever's ahead. */
  lookPressed: boolean;
  /** Anything held or pushed this frame (for the idle timeout). */
  active: boolean;
}

const DEADZONE = 0.3;

/**
 * Standard-mapping gamepad buttons (USB or Bluetooth; the browser maps them).
 * Bottom face button jumps, left/right face buttons run, like the 1985 layout.
 */
const PAD = { a: 0, b: 1, x: 2, y: 3, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };

type Held = Record<'left' | 'right' | 'up' | 'down' | 'jump' | 'run' | 'confirm' | 'back' | 'quit' | 'look' | 'esc', boolean>;

/** The first connected gamepad, if any. */
export function activePad(): Gamepad | undefined {
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  return [...pads].find((p): p is Gamepad => !!p && p.connected);
}

/** Polls keyboard and gamepad once a frame, turning held buttons into presses. */
export class PlayControls {
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private prev: Held = { left: false, right: false, up: false, down: false, jump: false, run: false, confirm: false, back: false, quit: false, look: false, esc: false };

  constructor(scene: Phaser.Scene) {
    const K = Phaser.Input.Keyboard.KeyCodes;
    // enableCapture=false: keys only get preventDefault while we're polling them.
    this.keys = scene.input.keyboard!.addKeys(
      { left: K.LEFT, right: K.RIGHT, up: K.UP, down: K.DOWN, a: K.A, d: K.D, w: K.W, s: K.S, space: K.SPACE, z: K.Z, x: K.X, e: K.E, shift: K.SHIFT, esc: K.ESC },
      false,
    ) as Record<string, Phaser.Input.Keyboard.Key>;
  }

  /** Stop arrow keys and space scrolling the page while playing. */
  capture(on: boolean, scene: Phaser.Scene) {
    const K = Phaser.Input.Keyboard.KeyCodes;
    const codes = [K.LEFT, K.RIGHT, K.UP, K.DOWN, K.SPACE];
    if (on) scene.input.keyboard!.addCapture(codes);
    else scene.input.keyboard!.removeCapture(codes);
  }

  read(): Controls {
    const k = this.keys;
    const pad = activePad();
    const btn = (i: number) => !!pad?.buttons[i]?.pressed;
    const ax = pad?.axes[0] ?? 0;
    const ay = pad?.axes[1] ?? 0;
    const held: Held = {
      left: k.left.isDown || k.a.isDown || btn(PAD.left) || ax < -DEADZONE,
      right: k.right.isDown || k.d.isDown || btn(PAD.right) || ax > DEADZONE,
      up: k.up.isDown || k.w.isDown || btn(PAD.up) || ay < -0.6,
      down: k.down.isDown || k.s.isDown || btn(PAD.down) || ay > 0.6,
      jump: k.space.isDown || k.z.isDown || btn(PAD.a),
      run: k.shift.isDown || k.x.isDown || btn(PAD.x) || btn(PAD.b),
      confirm: k.space.isDown || k.z.isDown || btn(PAD.a),
      back: btn(PAD.b),
      quit: btn(PAD.start) || btn(PAD.select),
      look: k.e.isDown || btn(PAD.y),
      esc: k.esc.isDown,
    };
    const pressed = (key: keyof Held) => held[key] && !this.prev[key];
    // An analogue stick gives a proportional push; keys and the d-pad are all or nothing.
    const stick = Math.abs(ax) > DEADZONE && !btn(PAD.left) && !btn(PAD.right) ? (ax - Math.sign(ax) * DEADZONE) / (1 - DEADZONE) : 0;
    const x = stick || (held.right ? 1 : 0) - (held.left ? 1 : 0);
    const out: Controls = {
      x,
      run: held.run,
      jumpHeld: held.jump,
      jumpPressed: pressed('jump'),
      downPressed: pressed('down'),
      leftPressed: pressed('left'),
      rightPressed: pressed('right'),
      upPressed: pressed('up'),
      confirmPressed: pressed('confirm'),
      backPressed: pressed('back'),
      quitPressed: pressed('quit'),
      lookPressed: pressed('look'),
      escPressed: pressed('esc'),
      active: Object.values(held).some(Boolean) || Math.abs(ax) > DEADZONE || Math.abs(ay) > DEADZONE,
    };
    this.prev = held;
    return out;
  }
}
