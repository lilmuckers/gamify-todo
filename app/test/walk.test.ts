import { describe, expect, it } from 'vitest';
import { MAX_WALK_MS, planWalk, POP_SHORT_TILES, POP_TILES, WALK_TILES_PER_SEC } from '../src/game/walk';

describe('planWalk', () => {
  it('strolls short walks at the normal pace', () => {
    expect(planWalk(7)).toEqual({ pop: false, tiles: 7, ms: 1000, pace: 1 });
  });

  it('hurries past the cap instead of taking longer', () => {
    const plan = planWalk(POP_TILES);
    expect(plan.pop).toBe(false);
    expect(plan.ms).toBe(MAX_WALK_MS);
    expect(plan.pace).toBeCloseTo((POP_TILES / WALK_TILES_PER_SEC) * 1000 / MAX_WALK_MS);
  });

  it('pops up just short of a far stop and walks the rest', () => {
    const plan = planWalk(60);
    expect(plan).toMatchObject({ pop: true, tiles: POP_SHORT_TILES, pace: 1 });
    expect(plan.ms).toBeLessThan(MAX_WALK_MS);
  });

  it('never plans a walk over the cap', () => {
    for (let tiles = 0; tiles <= 200; tiles += 0.5) expect(planWalk(tiles).ms).toBeLessThanOrEqual(MAX_WALK_MS);
  });
});
