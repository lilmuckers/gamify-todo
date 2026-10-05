import type Phaser from 'phaser';

/** Scene time each catch-up round moves on by. */
const STEP_MS = 250;
/** Most scene time one catch-up simulates, so a chain that never settles can't spin forever. */
const MAX_MS = 60_000;

/** Something whose one-off animations can be run forward without rendering. */
export interface Timeline {
  /** True while a tween, timer or camera effect that will end on its own is still running. */
  pending(): boolean;
  advance(ms: number): void;
}

/** The clock's event lists, which Phaser keeps private. */
interface ClockLists {
  _active: Phaser.Time.TimerEvent[];
  _pendingInsertion: Phaser.Time.TimerEvent[];
}

/** A scene's tweens, timers and camera effects as one timeline. */
export function sceneTimeline(scene: Phaser.Scene): Timeline {
  const clock = scene.time;
  const lists = clock as unknown as ClockLists;
  return {
    pending: () =>
      scene.tweens
        .getTweens()
        .some((t) => !t.isInfinite && !t.paused && !t.isFinished() && !t.isPendingRemove() && !t.isDestroyed()) ||
      [...lists._active, ...lists._pendingInsertion].some((e) => !e.loop && !e.paused && !e.hasDispatched) ||
      scene.cameras.cameras.some(
        (c) => c.fadeEffect.isRunning || c.panEffect.isRunning || c.zoomEffect.isRunning || c.shakeEffect.isRunning || c.flashEffect.isRunning,
      ),
    advance: (ms) => {
      // The tween manager keeps its own wall clock: pretend `ms` more has passed, then step.
      scene.tweens.startTime -= ms;
      scene.tweens.step(true);
      clock.preUpdate(clock.now, ms);
      clock.update(clock.now + ms, ms);
      for (const c of scene.cameras.cameras) {
        for (const fx of [c.panEffect, c.zoomEffect, c.shakeEffect, c.flashEffect, c.fadeEffect]) fx.update(clock.now, ms);
      }
    },
  };
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let catchingUp = false;

/** True while a catch-up is running animations to their end: sounds stay quiet. */
export const isCatchingUp = () => catchingUp;

/**
 * Runs every one-off animation to its end, round by round, so promise chains
 * built on them (walks, warps, fades) get to schedule their next step and
 * finish too. `timelines` is asked again each round, as a finished chain may
 * start a new scene. Infinite loops (bobbing blocks, blinking arrows) are
 * ignored; they just move on with everything else.
 */
export async function fastForward(timelines: () => Timeline[], settle: () => Promise<void> = nextTask): Promise<void> {
  for (let elapsed = 0; elapsed < MAX_MS; elapsed += STEP_MS) {
    // Let awaiting code see the tweens that just finished (maybe on the frame
    // that woke the game) and queue what comes next.
    await settle();
    const all = timelines();
    if (!all.some((t) => t.pending())) return;
    for (const t of all) t.advance(STEP_MS);
  }
}

/**
 * Catches the game up after the tab was hidden. The browser stops animation
 * frames in a background tab, so a warp or flagpole half-way through would
 * otherwise carry on from where it paused (issue #21).
 */
export function catchUpOnResume(game: Phaser.Game) {
  const timelines = () => game.scene.getScenes(true).filter((s) => s.scene.key !== 'boot').map(sceneTimeline);
  game.events.on('resume', () => {
    if (catchingUp || document.hidden) return;
    catchingUp = true;
    void fastForward(timelines).finally(() => (catchingUp = false));
  });
}
