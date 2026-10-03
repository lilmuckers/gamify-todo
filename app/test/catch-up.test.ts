import { describe, expect, it } from 'vitest';
import { fastForward, type Timeline } from '../src/game/catch-up';

/** A fake scene clock: one-off timers that resolve promises, like the scenes' `tween()`/`wait()`. */
function fakeScene() {
  let now = 0;
  const timers: { at: number; done: () => void }[] = [];
  const timeline: Timeline = {
    pending: () => timers.length > 0,
    advance: (ms) => {
      now += ms;
      for (const t of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.done();
      }
    },
  };
  const wait = (ms: number) => new Promise<void>((done) => timers.push({ at: now + ms, done }));
  return { timeline, wait, now: () => now };
}

describe('fastForward', () => {
  it('runs a chain of animations to the end, each one started by the last', async () => {
    const scene = fakeScene();
    const steps: string[] = [];
    // A warp: walk to the pipe, sink, fade out, then change the route.
    const warp = (async () => {
      await scene.wait(1200);
      steps.push('walked');
      await scene.wait(500);
      steps.push('sank');
      await scene.wait(520);
      steps.push('navigated');
    })();
    await fastForward(() => [scene.timeline]);
    expect(steps).toEqual(['walked', 'sank', 'navigated']);
    await warp;
  });

  it("lets code woken just before it queue its next step, so a chain isn't missed", async () => {
    // Waking the game runs a frame at once: the last tween ends, but the
    // code awaiting it hasn't started the next one yet.
    const scene = fakeScene();
    let landed = false;
    void Promise.resolve()
      .then(() => scene.wait(500))
      .then(() => (landed = true));
    await fastForward(() => [scene.timeline]);
    expect(landed).toBe(true);
  });

  it('stops as soon as nothing is left to finish', async () => {
    const scene = fakeScene();
    void scene.wait(300);
    await fastForward(() => [scene.timeline]);
    expect(scene.now()).toBe(500);
  });

  it('does nothing when every scene is idle, and moves idle scenes on with busy ones', async () => {
    const idle = fakeScene();
    await fastForward(() => [idle.timeline]);
    expect(idle.now()).toBe(0);

    const busy = fakeScene();
    void busy.wait(100);
    await fastForward(() => [idle.timeline, busy.timeline]);
    expect(idle.now()).toBe(250);
  });

  it('picks up a scene started part-way through', async () => {
    const first = fakeScene();
    const second = fakeScene();
    let scenes = [first.timeline];
    let arrived = false;
    void first.wait(400).then(async () => {
      // The route changed: the next scene plays its arrival.
      scenes = [second.timeline];
      await second.wait(600);
      arrived = true;
    });
    await fastForward(() => scenes);
    expect(arrived).toBe(true);
  });

  it('gives up on a timeline that never settles', async () => {
    let advanced = 0;
    const stuck: Timeline = { pending: () => true, advance: (ms) => (advanced += ms) };
    await fastForward(() => [stuck], async () => {});
    expect(advanced).toBe(60_000);
  });
});
